from datetime import date, timedelta
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from src.agent.rules import Rule, RuleType, RulesEngine
from src.data.peak_tracker import PeakTracker
from src.data.portfolio import FundHolding, Portfolio


class StopLossTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / "peak_state.json"
        self.engine = RulesEngine(str(self.root / "rules.json"))
        self.rule = Rule("测试止损", RuleType.STOP_LOSS, "测试基金", "从高点回撤8%", 8, "规则提醒")

    def snapshot(self, rate, offset=-2, peak=None, cost=100, position_id="", name="测试基金"):
        return Portfolio([FundHolding(
            name=name, code="000001", amount=100, sector="其他", cost_basis=cost,
            profit_rate=rate, peak_rate=peak, position_id=position_id,
        )], as_of=(date.today() + timedelta(days=offset)).isoformat())

    def observe(self, snapshot):
        return PeakTracker(str(self.state)).observe(snapshot)

    def check(self, snapshot):
        return self.engine.check_stop_loss(self.rule, self.observe(snapshot))

    def test_first_record_and_repeated_same_snapshot_stay_pending(self):
        first = self.check(self.snapshot(40))
        second = self.check(self.snapshot(40))
        self.assertFalse(first.evaluated)
        self.assertFalse(second.evaluated)
        entry = json.loads(self.state.read_text())["positions"]["000001"]
        self.assertEqual(entry["peak_rate"], 40)
        self.assertEqual(entry["samples"], 1)

    def test_peak_survives_restarts_and_increases_then_detects_decline(self):
        self.check(self.snapshot(40, -3))
        self.check(self.snapshot(60, -2))
        result = self.check(self.snapshot(42, -1))
        self.assertTrue(result.evaluated)
        self.assertTrue(result.triggered)
        self.assertAlmostEqual(result.current_value, 11.25)
        self.assertEqual(json.loads(self.state.read_text())["positions"]["000001"]["peak_rate"], 60)

    def test_return_percentage_points_are_not_mistaken_for_value_drawdown(self):
        result = self.check(self.snapshot(40, peak=50))
        self.assertTrue(result.evaluated)
        self.assertFalse(result.triggered)
        self.assertAlmostEqual(result.current_value, 100 * 10 / 150)

    def test_exact_threshold_triggers(self):
        result = self.check(self.snapshot(38, peak=50))
        self.assertTrue(result.triggered)
        self.assertAlmostEqual(result.current_value, 8)

    def test_supplied_peak_can_trigger_on_first_run(self):
        result = self.check(self.snapshot(35, peak=50))
        self.assertTrue(result.evaluated)
        self.assertTrue(result.triggered)
        self.assertAlmostEqual(result.current_value, 10)

    def test_negative_returns_do_not_invent_zero_as_a_peak(self):
        first = self.check(self.snapshot(-10, -2))
        result = self.check(self.snapshot(-20, -1))
        self.assertFalse(first.evaluated)
        self.assertTrue(result.triggered)
        self.assertAlmostEqual(result.current_value, 100 * 10 / 90)

    def test_missing_or_nonfinite_return_stays_pending_without_overwriting_peak(self):
        self.check(self.snapshot(50))
        before = self.state.read_bytes()
        for rate in [None, float("nan"), float("inf"), -100, True]:
            with self.subTest(rate=rate):
                result = self.check(self.snapshot(rate, -1))
                self.assertFalse(result.evaluated)
                self.assertEqual(self.state.read_bytes(), before)

    def test_older_or_undated_snapshot_does_not_overwrite_dated_peak(self):
        self.check(self.snapshot(50, -1))
        before = self.state.read_bytes()
        old = self.check(self.snapshot(5, -3))
        undated = self.snapshot(5)
        undated.as_of = None
        missing_date = self.check(undated)
        self.assertFalse(old.evaluated)
        self.assertFalse(missing_date.evaluated)
        self.assertEqual(self.state.read_bytes(), before)

    def test_cost_change_restarts_peak_instead_of_false_stop_loss(self):
        self.check(self.snapshot(60, -2, cost=100))
        result = self.check(self.snapshot(5, -1, cost=200))
        self.assertFalse(result.evaluated)
        self.assertFalse(result.triggered)
        self.assertIn("成本或持仓批次变化", result.message)
        self.assertEqual(json.loads(self.state.read_text())["positions"]["000001"]["peak_rate"], 5)

    def test_cost_becoming_known_requires_a_new_comparable_baseline(self):
        self.check(self.snapshot(60, -2, cost=None))
        result = self.check(self.snapshot(5, -1, cost=100))
        self.assertFalse(result.evaluated)
        self.assertFalse(result.triggered)

    def test_invalid_cost_does_not_overwrite_peak(self):
        self.check(self.snapshot(60, -2))
        before = self.state.read_bytes()
        result = self.check(self.snapshot(5, -1, cost=-100))
        self.assertFalse(result.evaluated)
        self.assertEqual(self.state.read_bytes(), before)

    def test_closed_then_reopened_holding_starts_a_new_peak(self):
        self.check(self.snapshot(60, -3))
        self.observe(Portfolio([], as_of=(date.today() - timedelta(days=2)).isoformat()))
        result = self.check(self.snapshot(5, -1))
        self.assertFalse(result.evaluated)
        self.assertFalse(result.triggered)
        self.assertEqual(json.loads(self.state.read_text())["positions"]["000001"]["peak_rate"], 5)

    def test_new_position_does_not_reimport_unchanged_old_peak(self):
        self.check(self.snapshot(50, -3, peak=60, position_id="first"))
        first = self.check(self.snapshot(5, -2, peak=60, position_id="second"))
        second = self.check(self.snapshot(5, -1, peak=60, position_id="second"))
        self.assertFalse(first.evaluated)
        self.assertFalse(second.triggered)
        self.assertEqual(json.loads(self.state.read_text())["positions"]["000001"]["peak_rate"], 5)

    def test_new_known_high_can_be_imported_later(self):
        self.check(self.snapshot(40, -2))
        result = self.check(self.snapshot(35, -1, peak=50))
        self.assertTrue(result.evaluated)
        self.assertTrue(result.triggered)

    def test_fund_rename_keeps_history_for_same_code(self):
        self.check(self.snapshot(50, -2))
        info = self.observe(self.snapshot(30, -1, name="新名称"))
        self.assertEqual(info["新名称"]["peak_rate"], 50)
        self.assertTrue(info["新名称"]["history_ready"])

    def test_missing_target_is_pending_instead_of_silently_skipped(self):
        result = self.engine.check_stop_loss(self.rule, {})
        self.assertFalse(result.evaluated)
        self.assertFalse(result.triggered)

    def test_corrupt_state_is_not_replaced(self):
        original = '{"version": 1, "positions": {"000001": {"peak_rate": null}}}'
        self.state.write_text(original)
        with self.assertRaises(ValueError):
            self.observe(self.snapshot(20))
        self.assertEqual(self.state.read_text(), original)

    def test_future_snapshot_is_rejected_without_creating_state(self):
        with self.assertRaises(ValueError):
            self.observe(self.snapshot(20, 1))
        self.assertFalse(self.state.exists())

    def test_portfolio_round_trip_preserves_peak_and_position_metadata(self):
        original = self.snapshot(30, peak=50, position_id="holding-1")
        restored = Portfolio.from_dict(original.to_dict())
        self.assertEqual(restored.as_of, original.as_of)
        self.assertEqual(restored.holdings[0].peak_rate, 50)
        self.assertEqual(restored.holdings[0].position_id, "holding-1")

    def test_cli_records_and_triggers_across_separate_processes(self):
        self.engine.add(self.rule)
        path = self.root / "portfolio.json"
        path.write_text(json.dumps(self.snapshot(60, -2).to_dict()))
        driver = "import cli; cli.cmd_check_rules(" + repr(str(self.engine.rules_path)) + "," + repr(str(path)) + ")"
        first = subprocess.run([sys.executable, "-c", driver], capture_output=True, text=True, timeout=20)
        self.assertEqual(first.returncode, 0, first.stderr)
        self.assertIn("待补数据", first.stdout)
        self.assertNotIn("全部规则通过", first.stdout)
        path.write_text(json.dumps(self.snapshot(42, -1).to_dict()))
        second = subprocess.run([sys.executable, "-c", driver], capture_output=True, text=True, timeout=20)
        self.assertEqual(second.returncode, 0, second.stderr)
        self.assertIn("触发 1 条", second.stdout)
        self.assertIn("回撤 11.25%", second.stdout)


if __name__ == "__main__":
    unittest.main()
