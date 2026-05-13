"""Rules engine. User-defined discipline rules — not recommendations.

Rules are conditions the user sets for themselves. The engine checks them
and reports violations, but never tells the user what to buy or sell.
"""

from dataclasses import dataclass, field
from typing import Optional, Literal
from enum import Enum
import json
import os
from datetime import datetime, date


class RuleType(Enum):
    STOP_LOSS = "stop_loss"         # 回撤止损线
    CONCENTRATION = "concentration" # 仓位集中度上限
    POSITION_MIN = "position_min"   # 最低仓位
    REGULAR_CHECK = "regular_check" # 定期检查提醒


@dataclass
class Rule:
    name: str
    rule_type: RuleType
    target: str          # fund name, sector, or industry, or "all"
    condition: str       # e.g. "drawdown > 8%", "concentration > 65%"
    threshold: float     # numeric threshold
    action: str          # reminder text, not a trading instruction
    enabled: bool = True
    created_at: str = ""
    last_triggered: Optional[str] = None

    def __post_init__(self):
        if not self.created_at:
            self.created_at = date.today().isoformat()


@dataclass
class RuleCheckResult:
    rule: Rule
    triggered: bool
    current_value: float
    message: str


class RulesEngine:
    """Load, save, and check user-defined rules."""

    def __init__(self, rules_path: str):
        self.rules_path = rules_path
        self.rules: list[Rule] = []
        self._load()

    def _load(self) -> None:
        if os.path.exists(self.rules_path):
            with open(self.rules_path) as f:
                data = json.load(f)
            self.rules = [
                Rule(
                    name=r["name"],
                    rule_type=RuleType(r["rule_type"]),
                    target=r["target"],
                    condition=r["condition"],
                    threshold=r["threshold"],
                    action=r["action"],
                    enabled=r.get("enabled", True),
                    created_at=r.get("created_at", ""),
                    last_triggered=r.get("last_triggered"),
                )
                for r in data.get("rules", [])
            ]

    def save(self) -> None:
        data = {
            "rules": [
                {
                    "name": r.name,
                    "rule_type": r.rule_type.value,
                    "target": r.target,
                    "condition": r.condition,
                    "threshold": r.threshold,
                    "action": r.action,
                    "enabled": r.enabled,
                    "created_at": r.created_at,
                    "last_triggered": r.last_triggered,
                }
                for r in self.rules
            ],
            "updated_at": datetime.now().isoformat(),
        }
        with open(self.rules_path, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def add(self, rule: Rule) -> None:
        self.rules.append(rule)
        self.save()

    def remove(self, name: str) -> bool:
        before = len(self.rules)
        self.rules = [r for r in self.rules if r.name != name]
        if len(self.rules) < before:
            self.save()
            return True
        return False

    def enable(self, name: str, enabled: bool = True) -> bool:
        for r in self.rules:
            if r.name == name:
                r.enabled = enabled
                self.save()
                return True
        return False

    # ── check methods ─────────────────────────────────────

    def check_stop_loss(
        self, rule: Rule, portfolio_data: dict
    ) -> Optional[RuleCheckResult]:
        """Check if a fund has drawn down past its stop-loss line.

        portfolio_data keys: fund_name -> {profit_rate, amount, peak_rate}
        """
        fund_name = rule.target
        info = portfolio_data.get(fund_name)
        if not info:
            return None

        # In Phase 1 we don't have peak_rate stored yet.
        # For now, use profit_rate — if it's dropped below a threshold
        # relative to the highest recorded profit rate.
        current_rate = info.get("profit_rate", 0)
        peak_rate = info.get("peak_rate", current_rate)
        drawdown = peak_rate - current_rate

        triggered = drawdown >= rule.threshold
        return RuleCheckResult(
            rule=rule,
            triggered=triggered,
            current_value=drawdown,
            message=(
                f"🔴 {fund_name} 从最高收益率 {peak_rate:+.1f}% 回撤了 {drawdown:.1f}%"
                f"（触发线：{rule.threshold}%）\n"
                f"   规则：{rule.action}"
            )
            if triggered
            else (
                f"🟢 {fund_name} 当前回撤 {drawdown:.1f}%，"
                f"距止损线 {rule.threshold}% 还有 {rule.threshold - drawdown:.1f}% 安全垫"
            ),
        )

    def check_concentration(
        self, rule: Rule, industry_exposure: dict
    ) -> Optional[RuleCheckResult]:
        """Check if an industry's concentration exceeds the limit."""
        target_industry = rule.target  # e.g. "科技/AI" or "科技"
        total_pct = 0
        for ind, info in industry_exposure.items():
            if target_industry in ind:
                total_pct += info["pct"]

        triggered = total_pct > rule.threshold
        return RuleCheckResult(
            rule=rule,
            triggered=triggered,
            current_value=total_pct,
            message=(
                f"🔴 {target_industry} 仓位 {total_pct}% 超出上限 {rule.threshold}%\n"
                f"   规则：{rule.action}"
            )
            if triggered
            else (
                f"🟢 {target_industry} 仓位 {total_pct}%，"
                f"距上限 {rule.threshold}% 还有 {rule.threshold - total_pct:.1f}%"
            ),
        )

    def check_regular(
        self, rule: Rule, today: Optional[date] = None
    ) -> RuleCheckResult:
        """Check if a regular task is due (e.g. weekly review)."""
        today = today or date.today()
        triggered = False
        if rule.last_triggered:
            last = date.fromisoformat(rule.last_triggered)
            days_since = (today - last).days
            triggered = days_since >= rule.threshold
        else:
            triggered = True  # never checked before

        return RuleCheckResult(
            rule=rule,
            triggered=triggered,
            current_value=0,
            message=(
                f"📋 {rule.action}"
            )
            if triggered
            else "✅ 已检查",
        )

    def check_all(
        self, portfolio_data: dict, industry_exposure: dict
    ) -> list[RuleCheckResult]:
        """Run all enabled rules and return results."""
        results = []
        for rule in self.rules:
            if not rule.enabled:
                continue

            result = None
            if rule.rule_type == RuleType.STOP_LOSS:
                result = self.check_stop_loss(rule, portfolio_data)
            elif rule.rule_type == RuleType.CONCENTRATION:
                result = self.check_concentration(rule, industry_exposure)
            elif rule.rule_type == RuleType.REGULAR_CHECK:
                result = self.check_regular(rule)

            if result:
                results.append(result)
                if result.triggered:
                    rule.last_triggered = date.today().isoformat()
                    self.save()

        return results


# ── default rules for the user's portfolio ────────────────

def create_default_rules() -> list[Rule]:
    """Generate starter rules based on the user's actual portfolio."""
    return [
        Rule(
            name="AI基金回撤8%止损",
            rule_type=RuleType.STOP_LOSS,
            target="富国创业板人工智能ETF联接A",
            condition="从最高收益率回撤超过8%",
            threshold=8.0,
            action="从今日高点回撤超过 8% 时，减仓 1/3。不是清仓——保留大部分仓位，但锁定一部分利润。",
        ),
        Rule(
            name="半导体基金回撤10%止损",
            rule_type=RuleType.STOP_LOSS,
            target="招商中证半导体产业ETF联接C",
            condition="从最高收益率回撤超过10%",
            threshold=10.0,
            action="半导体板块回撤超过 10% 时减仓 1/3。三只半导体（招商半导体/科创芯片/永赢）同时审视。",
        ),
        Rule(
            name="永赢半导体回撤12%止损",
            rule_type=RuleType.STOP_LOSS,
            target="永赢先锋半导体智选混合C",
            condition="从最高收益率回撤超过12%",
            threshold=12.0,
            action="永赢波动大，给更多空间。回撤超 12% 减仓 1/3。",
        ),
        Rule(
            name="CPO基金回撤8%止损",
            rule_type=RuleType.STOP_LOSS,
            target="华泰柏瑞质量成长混合C",
            condition="从最高收益率回撤超过8%",
            threshold=8.0,
            action="CPO 高波动，8% 回撤线。触及时减仓 1/3。",
        ),
        Rule(
            name="科技仓位不超过65%",
            rule_type=RuleType.CONCENTRATION,
            target="科技",
            condition="科技行业仓位超过总资产65%",
            threshold=65.0,
            action="科技仓位超过 65% 时暂停加仓科技类基金。把新资金投向其他行业或债券。",
        ),
        Rule(
            name="每周复盘（周五）",
            rule_type=RuleType.REGULAR_CHECK,
            target="all",
            condition="距离上次复盘超过7天",
            threshold=7.0,
            action="今天是每周复盘日。打开 Fund Agent 跑一次持仓诊断，看有没有止损线需要更新。",
        ),
    ]
