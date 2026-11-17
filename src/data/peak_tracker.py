"""Persist observed return high-water marks, scoped to a holding's cost basis.

Unknown pre-tracking history is never reconstructed from a zero return.
Snapshot dates and recording timestamps are deliberately separate.
"""

from datetime import date, datetime, timezone
import json
import math
import os
from pathlib import Path
import tempfile

from src.data.portfolio import Portfolio


def _rate(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number > -100 else None


def _cost(holding):
    value = holding.cost_basis
    if value is None and holding.profit is not None:
        value = holding.amount - holding.profit
    if value is None:
        return None
    value = float(value)
    return value if math.isfinite(value) and value > 0 else None


class PeakTracker:
    def __init__(self, path: str):
        self.path = Path(path)
        self.positions = {}
        if self.path.exists():
            with self.path.open(encoding="utf-8") as stream:
                data = json.load(stream)
            if not isinstance(data, dict) or data.get("version") != 1 or not isinstance(data.get("positions"), dict):
                raise ValueError("峰值记录格式无效，请检查 peak_state.json；原记录未覆盖")
            self.positions = data["positions"]
            for entry in self.positions.values():
                if not isinstance(entry, dict) or _rate(entry.get("peak_rate")) is None or _rate(entry.get("last_rate")) is None:
                    raise ValueError("峰值记录含无效收益率；原记录未覆盖")
                if not isinstance(entry.get("samples"), int) or entry["samples"] < 1 or not isinstance(entry.get("provided_history"), bool):
                    raise ValueError("峰值记录缺少有效观察次数或历史来源；原记录未覆盖")
                entry["peak_rate"] = _rate(entry["peak_rate"])
                entry["last_rate"] = _rate(entry["last_rate"])

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=self.path.parent,
                                             prefix=".peak-", delete=False) as stream:
                temp_path = stream.name
                json.dump({"version": 1, "positions": self.positions}, stream,
                          ensure_ascii=False, indent=2, allow_nan=False)
            os.replace(temp_path, self.path)
        finally:
            if temp_path and os.path.exists(temp_path):
                os.unlink(temp_path)

    def observe(self, portfolio: Portfolio) -> dict:
        as_of = portfolio.as_of
        if as_of is not None:
            as_of = date.fromisoformat(as_of).isoformat()
            if date.fromisoformat(as_of) > datetime.now(timezone.utc).astimezone().date():
                raise ValueError("持仓快照日期不能晚于今天")
        before = json.dumps(self.positions, sort_keys=True)
        now = datetime.now(timezone.utc).isoformat(timespec="seconds")
        prepared = {}
        for holding in portfolio.holdings:
            info = {"amount": holding.amount, "profit_rate": holding.profit_rate, "as_of": as_of}
            prepared[holding.name] = info
            current = _rate(holding.profit_rate)
            declared = _rate(holding.peak_rate)
            if current is None or (holding.peak_rate is not None and declared is None):
                info["pending_reason"] = "缺少有效收益率或已知峰值（必须是大于 -100% 的有限数值）"
                continue

            key = str(holding.code) if holding.code else "name:" + holding.name
            previous = self.positions.get(key)
            try:
                cost = _cost(holding)
            except (TypeError, ValueError):
                cost = None
            if (holding.cost_basis is not None or holding.profit is not None) and cost is None:
                info["pending_reason"] = "持仓成本无效，未更新现有峰值"
                continue
            reset = bool(previous and (
                not previous.get("active", True) or
                previous.get("position_id", "") != holding.position_id or
                ((previous.get("cost_basis") is None) != (cost is None)) or
                (previous.get("cost_basis") is not None and cost is not None and
                 not math.isclose(previous["cost_basis"], cost, rel_tol=1e-4, abs_tol=0.05))
            ))
            # Reject older/undated observations even when their cost basis differs.
            if previous and previous.get("last_as_of") and (as_of is None or as_of < previous["last_as_of"]):
                info["pending_reason"] = "快照日期缺失或早于最近记录，未覆盖现有峰值"
                continue

            if previous is None or reset:
                # An unchanged peak declaration belongs to the old cost basis.
                import_peak = declared is not None and (not reset or declared != previous.get("declared_peak_rate"))
                peak = max(current, declared) if import_peak else current
                entry = {
                    "name": holding.name, "position_id": holding.position_id, "cost_basis": cost, "active": True,
                    "peak_rate": peak, "last_rate": current, "last_as_of": as_of,
                    "peak_as_of": as_of if peak == current else None,
                    "started_at": now, "last_recorded_at": now,
                    "samples": 1, "provided_history": import_peak, "declared_peak_rate": declared,
                }
                info["new_baseline"] = "成本或持仓批次变化（含移除后重新持有），已重新开始记录" if reset else "首次记录"
            else:
                entry = dict(previous)
                changed = current != entry["last_rate"] or as_of != entry.get("last_as_of")
                if changed:
                    entry["samples"] += 1
                    entry.update(last_rate=current, last_as_of=as_of, last_recorded_at=now)
                if current > entry["peak_rate"]:
                    entry.update(peak_rate=current, peak_as_of=as_of)
                if declared is not None and declared != entry.get("declared_peak_rate"):
                    if declared > entry["peak_rate"]:
                        entry.update(peak_rate=declared, peak_as_of=None)
                    entry["provided_history"] = True
                entry.update(name=holding.name, declared_peak_rate=declared, active=True)
                if entry.get("cost_basis") is None:
                    entry["cost_basis"] = cost

            self.positions[key] = entry
            ready = entry["provided_history"] or entry["samples"] > 1
            info.update(peak_rate=entry["peak_rate"], history_ready=ready,
                        history_scope="已知/记录以来的峰值" if entry["provided_history"] else "开始跟踪以来的峰值")
            if not ready:
                info["pending_reason"] = info.get("new_baseline", "仅有一份快照") + "，尚无此前高点；请更新快照或填写已知 peak_rate"
        current_keys = {str(h.code) if h.code else "name:" + h.name for h in portfolio.holdings}
        for key, entry in self.positions.items():
            if key not in current_keys and (not entry.get("last_as_of") or (as_of and as_of >= entry["last_as_of"])):
                entry["active"] = False
        if json.dumps(self.positions, sort_keys=True) != before:
            self._save()
        return prepared
