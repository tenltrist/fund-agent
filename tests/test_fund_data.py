from datetime import timedelta
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import pandas as pd

from src.data import akshare_client as data


class FundCoverageTests(unittest.TestCase):
    def setUp(self):
        self.today = pd.Timestamp.now(tz="Asia/Shanghai").date()

    def estimates(self, codes, returns=None, navs=None, day=None):
        day = day or self.today
        return pd.DataFrame({
            "基金代码": codes, "基金名称": ["来源基金"] * len(codes),
            f"{day}-估算数据-估算增长率": returns or ["1.5%"] * len(codes),
            f"{day}-估算数据-估算值": navs or [1.2] * len(codes),
        })

    def confirmed(self, codes, day=None):
        return pd.DataFrame({
            "code": codes, "name": ["来源基金"] * len(codes),
            "date": [day or self.today - timedelta(days=3)] * len(codes),
            "nav": [1.1] * len(codes), "daily_return": [0.8] * len(codes),
        })

    def fetch(self, codes, estimates, confirmed):
        estimate_call = Mock(side_effect=estimates) if isinstance(estimates, Exception) else Mock(return_value=estimates)
        rank_call = Mock(side_effect=confirmed) if isinstance(confirmed, Exception) else Mock(return_value=confirmed)
        with patch.dict(sys.modules, {"akshare": SimpleNamespace(fund_value_estimation_em=estimate_call)}), patch.object(
            data, "fetch_fund_rankings", rank_call
        ):
            result = data.fetch_my_fund_data(codes, {code: "我的" + str(code) for code in codes})
        return result, estimate_call, rank_call

    def test_two_estimates_are_completed_to_thirteen_without_replacing_estimates(self):
        codes = [f"{i:06d}" for i in range(1, 14)]
        result, _, ranks = self.fetch(codes, self.estimates([1, 2.0]), self.confirmed(codes))
        self.assertEqual(result["code"].tolist(), codes)
        self.assertEqual(result["source"].value_counts().to_dict(), {"已公布净值": 11, "盘中估算": 2})
        self.assertEqual(result.iloc[0]["nav"], 1.2)
        self.assertEqual(result.iloc[2]["date"], self.today - timedelta(days=3))
        self.assertEqual(result.attrs["missing_codes"], [])
        self.assertEqual(result.iloc[0]["my_name"], "我的000001")
        ranks.assert_called_once_with()

    def test_full_estimates_skip_confirmed_request_and_deduplicate_input(self):
        result, _, ranks = self.fetch(["000002", "000001", "000002"], self.estimates(["000001", "000002"]), None)
        self.assertEqual(result["code"].tolist(), ["000002", "000001"])
        ranks.assert_not_called()

    def test_invalid_estimates_are_replaced_with_valid_confirmed_values(self):
        codes = ["000001", "000002", "000003", "000004"]
        estimate = self.estimates(codes, returns=["--", "inf", "2%", "2%"], navs=[1, 1, 0, float("inf")])
        result, _, _ = self.fetch(codes, estimate, self.confirmed(codes))
        self.assertEqual(len(result), 4)
        self.assertEqual(set(result["source"]), {"已公布净值"})

    def test_confirmed_outage_preserves_estimates_and_reports_missing_codes(self):
        result, _, _ = self.fetch(["000001", "000002"], self.estimates(["000001"]), RuntimeError("上游暂不可用"))
        self.assertEqual(result["code"].tolist(), ["000001"])
        self.assertEqual(result.attrs["missing_codes"], ["000002"])
        self.assertIn("已公布净值补全失败", result.attrs["warnings"][0])

    def test_estimate_outage_still_returns_confirmed_data(self):
        result, _, _ = self.fetch(["000001"], RuntimeError("估算暂不可用"), self.confirmed(["000001"]))
        self.assertEqual(result.iloc[0]["source"], "已公布净值")
        self.assertIn("盘中估算不可用", result.attrs["warnings"][0])

    def test_no_sources_raise_instead_of_inventing_zero_returns(self):
        with self.assertRaisesRegex(RuntimeError, "盘中估算不可用.*已公布净值补全失败"):
            self.fetch(["000001"], RuntimeError("估算失败"), RuntimeError("净值失败"))

    def test_old_estimates_are_not_relabelled_as_today(self):
        result, _, _ = self.fetch(["000001"], self.estimates(["000001"], day=self.today - timedelta(days=1)), self.confirmed(["000001"]))
        self.assertEqual(result.iloc[0]["source"], "已公布净值")
        self.assertNotEqual(result.iloc[0]["date"], self.today)

    def test_latest_valid_confirmed_row_wins_and_invalid_dates_remain_missing(self):
        confirmed = pd.concat([
            self.confirmed(["000001"], self.today - timedelta(days=5)),
            self.confirmed(["000001"], self.today - timedelta(days=1)),
            self.confirmed(["000002"], self.today + timedelta(days=1)),
            self.confirmed(["000003"], "无日期"),
        ], ignore_index=True)
        result, _, _ = self.fetch(["000001", "000002", "000003"], RuntimeError("无估算"), confirmed)
        self.assertEqual(result["code"].tolist(), ["000001"])
        self.assertEqual(result.iloc[0]["date"], self.today - timedelta(days=1))
        self.assertEqual(result.attrs["missing_codes"], ["000002", "000003"])

    def test_empty_portfolio_does_not_call_sources(self):
        result, estimates, ranks = self.fetch([], None, None)
        self.assertTrue(result.empty)
        estimates.assert_not_called()
        ranks.assert_not_called()


if __name__ == "__main__":
    unittest.main()
