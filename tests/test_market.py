import contextlib
from datetime import date
import io
import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import pandas as pd

import cli
from src.data import akshare_client as data


class DataCompatibilityTests(unittest.TestCase):
    def test_current_index_api(self):
        fetch = Mock(return_value=pd.DataFrame({
            "名称": ["上证指数", "其他指数"],
            "最新价": [3000, 1000],
            "涨跌幅": ["1.2", "0.5"],
        }))
        with patch.dict(sys.modules, {"akshare": SimpleNamespace(index_zh_spot_sina=fetch)}):
            result = data.fetch_index_spot()
        self.assertEqual(result["name"].tolist(), ["上证指数"])
        self.assertAlmostEqual(result.iloc[0]["change"], 1.2)

    def test_legacy_index_api(self):
        fetch = Mock(return_value=pd.DataFrame({
            "名称": ["沪深300"], "最新价": [4000], "涨跌幅": [1.0],
        }))
        with patch.dict(sys.modules, {"akshare": SimpleNamespace(stock_zh_index_spot_sina=fetch)}):
            result = data.fetch_index_spot()
        self.assertEqual(result["name"].tolist(), ["沪深300"])

    def test_unavailable_estimates_fall_back_to_dated_confirmed_nav(self):
        today = pd.Timestamp.now().strftime("%Y-%m-%d")
        invalid = pd.DataFrame({
            "基金代码": ["000001"], "基金名称": ["测试基金"],
            f"{today}-估算数据-估算增长率": ["--"],
            f"{today}-估算数据-估算值": ["--"],
        })
        confirmed = pd.DataFrame({
            "code": ["000001"], "name": ["测试基金"],
            "date": [date(2026, 11, 13)], "nav": [1.2], "daily_return": [1.5],
        })
        fake = SimpleNamespace(fund_value_estimation_em=Mock(return_value=invalid))
        with patch.dict(sys.modules, {"akshare": fake}), patch.object(
            data, "fetch_fund_rankings", return_value=confirmed
        ):
            result = data.fetch_my_fund_data(["000001"], {"000001": "我的基金"})
        self.assertEqual(result.iloc[0]["source"], "已公布净值")
        self.assertEqual(result.iloc[0]["date"], date(2026, 11, 13))

    def test_streak_uses_chronological_prices_and_reports_source_date(self):
        history = pd.DataFrame({
            "日期": [date(2026, 11, 16), date(2026, 11, 12), date(2026, 11, 13)],
            "收盘价": [90, 100, 95],
        })
        fake = SimpleNamespace(stock_board_industry_index_ths=Mock(return_value=history))
        with patch.dict(sys.modules, {"akshare": fake}):
            result = data.fetch_sector_consecutive_days("半导体")
        self.assertEqual(result["date"], "2026-11-16")
        self.assertEqual(result["direction"], "跌")
        self.assertEqual(result["streak"], 2)
        self.assertAlmostEqual(result["today_change"], (90 / 95 - 1) * 100)


class MarketDisplayTests(unittest.TestCase):
    def market_output(self, rows, streak=None):
        frame = pd.DataFrame(rows)
        output = io.StringIO()
        holdings = [
            {"name": "基金一", "code": "000001", "amount": 100, "sector": "其他"},
            {"name": "基金二", "code": "000002", "amount": 300, "sector": "其他"},
        ]
        with tempfile.TemporaryDirectory() as temp, contextlib.ExitStack() as stack:
            path = Path(temp) / "portfolio.json"
            path.write_text(json.dumps({"holdings": holdings}))
            for name in ["fetch_index_spot", "fetch_sector_fund_flow", "fetch_top_funds", "fetch_bottom_funds"]:
                stack.enter_context(patch.object(data, name, return_value=pd.DataFrame()))
            stack.enter_context(patch.object(data, "fetch_my_fund_data", return_value=frame))
            stack.enter_context(patch.object(data, "fetch_sector_consecutive_days", return_value=streak or {"error": "测试"}))
            stack.enter_context(patch.object(cli, "date", Mock(today=Mock(return_value=date(2026, 11, 16)))))
            stack.enter_context(contextlib.redirect_stdout(output))
            cli.cmd_market(str(path))
        return output.getvalue()

    @staticmethod
    def row(code, data_date="2026-11-16", source="盘中估算"):
        return {"code": code, "name": code, "my_name": code, "date": data_date,
                "source": source, "nav": 1.1, "daily_return": 2.0}

    def test_partial_coverage_does_not_claim_portfolio_daily_return(self):
        output = self.market_output([self.row("000001")])
        self.assertIn("数据覆盖：1/2 只，持仓市值 25.0%", output)
        self.assertIn("暂不计算组合今日涨跌", output)
        self.assertNotIn("今日涨跌（按配置仓位加权）", output)
        self.assertIn("2026-11-16 · 盘中估算", output)

    def test_stale_complete_data_does_not_claim_today_return(self):
        rows = [self.row(code, "2026-11-13", "已公布净值") for code in ["000001", "000002"]]
        output = self.market_output(rows)
        self.assertIn("数据覆盖：2/2 只，持仓市值 100.0%", output)
        self.assertIn("暂不计算组合今日涨跌", output)
        self.assertNotIn("今日涨跌（按配置仓位加权）", output)

    def test_estimate_and_older_confirmed_nav_cover_all_without_mixing_daily_returns(self):
        output = self.market_output([self.row("000001"), self.row("000002", "2026-11-13", "已公布净值")])
        self.assertIn("数据覆盖：2/2 只，持仓市值 100.0%", output)
        self.assertIn("盘中估算 1 只", output)
        self.assertIn("已公布净值 1 只", output)
        self.assertIn("暂不计算组合今日涨跌", output)
        self.assertNotIn("今日涨跌（按配置仓位加权）", output)

    def test_complete_current_data_can_show_weighted_daily_return(self):
        output = self.market_output([self.row("000001"), self.row("000002")])
        self.assertIn("今日涨跌（按配置仓位加权）：+2.00%", output)
        self.assertNotIn("暂不计算组合今日涨跌", output)

    def test_streak_displays_history_date(self):
        streak = {"date": "2026-11-13", "direction": "跌", "streak": 2, "today_change": -3.33}
        output = self.market_output([self.row("000001")], streak=streak)
        self.assertIn("连跌 2 天  最新 2026-11-13 -3.33%", output)
        self.assertNotIn("今日 -3.33%", output)


if __name__ == "__main__":
    unittest.main()
