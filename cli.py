#!/usr/bin/env python3
"""Fund Agent CLI — Phase 1: Portfolio Diagnosis + Rules Engine."""

import argparse
import os
from datetime import date
from src.data.portfolio import Portfolio
from src.analysis.doctor import (
    compute_industry_exposure,
    compute_overlap_groups,
    compute_concentration,
    assess_risk,
)
from src.data import akshare_client as ak
from src.agent.rules import (
    RulesEngine,
    Rule,
    RuleType,
    RuleCheckResult,
    create_default_rules,
)

PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))


def bar(pct: float, width: int = 40) -> str:
    filled = int(pct / 100 * width)
    return "█" * filled + "░" * (width - filled)


# ═══════════════════════════════════════════════════════════
# diagnose
# ═══════════════════════════════════════════════════════════

def cmd_diagnose(portfolio_path: str) -> dict:
    portfolio = Portfolio.from_json(portfolio_path)

    print()
    print("=" * 60)
    print("  📊 持仓诊断")
    print("=" * 60)
    print(f"  基金数量：{portfolio.fund_count} 只")
    print(f"  总资产：  ¥{portfolio.total_value:,.0f}")
    print(f"  总盈亏：  ¥{portfolio.total_profit:+,.0f}")
    print()

    # industry exposure
    print("─" * 60)
    print("  行业暴露")
    print("─" * 60)
    industries = compute_industry_exposure(portfolio)
    max_name_len = max(len(k) for k in industries)
    for name, info in industries.items():
        flag = ""
        if info["pct"] > 50:
            flag = " ⚠️ 集中"
        if 0 < info["pct"] < 5:
            flag = " (微量)"
        print(
            f"  {name:<{max_name_len}}  {bar(info['pct'])}  "
            f"{info['pct']:>5.1f}%  ¥{info['amount']:,.0f}{flag}"
        )
    print()

    # overlap
    print("─" * 60)
    print("  重叠度分析")
    print("─" * 60)
    overlaps = compute_overlap_groups(portfolio)
    if overlaps:
        for g in overlaps:
            if g["fund_count"] >= 2:
                print(f"  📦 {g['sector']}  {g.get('severity', '')}")
                print(f"     {g.get('level', '')} | {g['fund_count']} 只 | ¥{g['total_amount']:,.0f}")
                for i, name in enumerate(g["funds"]):
                    print(f"     {i+1}. {name}  ¥{g['amounts'][i]:,.0f}")
                if g["fund_count"] >= 3 and "跨细分" in g["sector"]:
                    print(f"     ⚠️ 底层持仓可能高度重叠——买多只 ≠ 分散风险")
                print()
    else:
        print("  ✅ 无显著重叠\n")

    # concentration
    print("─" * 60)
    print("  集中度")
    print("─" * 60)
    conc = compute_concentration(portfolio)
    print(f"  最大单只占比：{conc['top1_holding_pct']}%")
    print(f"  前 3 只占比： {conc['top3_holding_pct']}%")
    print(f"  前 5 只占比： {conc['top5_holding_pct']}%")
    print(f"  行业 HHI：   {conc['hhi']:.0f}  (有效分散度: {conc['effective_diversification']})")
    print()

    # risk
    print("─" * 60)
    print("  风险评估")
    print("─" * 60)
    risk = assess_risk(portfolio)
    print(f"  状态：{risk['status']}")
    print(f"  科技仓位：{risk['tech_pct']}%")
    print(f"  防御仓位：{risk['defensive_pct']}%")
    print(f"  预估最大回撤：{risk['estimated_max_drawdown']:.0%}")
    print(f"  承受上限：{risk['user_tolerance']:.0%}")
    if risk["flags"]:
        print()
        for flag in risk["flags"]:
            print(f"  {flag}")
    print()

    # small positions
    print("─" * 60)
    print("  碎片仓位（< 总资产 5%）")
    print("─" * 60)
    small = portfolio.small_positions(5.0)
    if small:
        for h in small:
            pct = h.amount / portfolio.total_value * 100
            print(f"  {h.name:<30s}  ¥{h.amount:,.0f}  ({pct:.1f}%)  {h.profit or 0:+,.0f}¥")
        print(f"\n  共 {len(small)} 只，合计 {sum(h.amount for h in small)/portfolio.total_value*100:.1f}%")
        print(f"  → 要么加仓到有意义的位置，要么合并/清掉")
    else:
        print("  ✅ 无碎片仓位")
    print()

    # profit structure
    print("─" * 60)
    print("  盈亏结构")
    print("─" * 60)
    winners = [h for h in portfolio.holdings if (h.profit or 0) > 0]
    losers = [h for h in portfolio.holdings if (h.profit or 0) < 0]
    print(f"  盈利：{len(winners)} 只  ¥+{sum(h.profit or 0 for h in winners):,.0f}")
    print(f"  亏损：{len(losers)} 只  ¥{sum(h.profit or 0 for h in losers):,.0f}")
    if losers:
        print(f"\n  亏损来源👇")
        for h in sorted(losers, key=lambda x: x.profit or 0):
            print(f"  {h.name:<30s}  {h.profit or 0:+,.0f}¥  ({h.profit_rate or 0:+.1f}%)")
    print()

    return {"industries": industries, "portfolio": portfolio}


# ═══════════════════════════════════════════════════════════
# rules
# ═══════════════════════════════════════════════════════════

def cmd_init_rules(rules_path: str) -> None:
    engine = RulesEngine(rules_path)
    if engine.rules:
        print("规则已存在。如需重置，先删除 data/rules.json")
        cmd_list_rules(engine)
        return

    for rule in create_default_rules():
        engine.add(rule)
    print("✅ 已创建 6 条默认止损/风控规则\n")
    cmd_list_rules(engine)


def cmd_list_rules(engine: RulesEngine) -> None:
    print()
    print("=" * 60)
    print("  📋 当前规则")
    print("=" * 60)
    if not engine.rules:
        print("  暂无规则。运行 `python3 cli.py init-rules` 创建默认规则。")
        return

    for i, r in enumerate(engine.rules, 1):
        status = "🟢" if r.enabled else "⚪"
        type_label = {
            RuleType.STOP_LOSS: "止损",
            RuleType.CONCENTRATION: "仓位",
            RuleType.REGULAR_CHECK: "定期",
            RuleType.POSITION_MIN: "最低仓位",
        }.get(r.rule_type, "?")
        print(f"  {i}. {status} [{type_label}] {r.name}")
        print(f"     目标：{r.target}  |  阈值：{r.threshold}%")
        print(f"     动作：{r.action}")
        print()
    print()


def cmd_check_rules(rules_path: str, portfolio_path: str) -> None:
    engine = RulesEngine(rules_path)
    if not engine.rules:
        print("暂无规则。运行 `python3 cli.py init-rules` 创建。")
        return

    portfolio = Portfolio.from_json(portfolio_path)

    # Build portfolio_data dict for rules engine
    portfolio_data = {}
    for h in portfolio.holdings:
        portfolio_data[h.name] = {
            "profit_rate": h.profit_rate or 0,
            "amount": h.amount,
            "peak_rate": max(h.profit_rate or 0, 0),
        }

    industries = compute_industry_exposure(portfolio)
    results = engine.check_all(portfolio_data, industries)

    print()
    print("=" * 60)
    print("  🛡️  规则检查")
    print("=" * 60)

    triggered = [r for r in results if r.triggered]
    ok = [r for r in results if not r.triggered]

    if triggered:
        print(f"\n  ⚠️  触发 {len(triggered)} 条：\n")
        for r in triggered:
            print(f"  {r.message}")
            print()

    if ok:
        print(f"  ✅ 未触发 ({len(ok)} 条)：")
        for r in ok:
            # short one-liner for non-triggered
            print(f"     {r.rule.name}")

    print()
    print("─" * 60)
    if not triggered:
        print("  全部规则通过。今天无需操作。")
    else:
        print("  以上是规则提醒——是否操作由你决定。")
    print("─" * 60)
    print()


# ═══════════════════════════════════════════════════════════
# market
# ═══════════════════════════════════════════════════════════

def cmd_market(portfolio_path: str) -> None:
    """Show today's market overview + auto-refresh my portfolio."""
    portfolio = Portfolio.from_json(portfolio_path)
    codes = [h.code for h in portfolio.holdings if h.code]
    fund_map = {h.code: h.name for h in portfolio.holdings if h.code}

    print()
    print("=" * 60)
    print("  📈 今日市场 · " + date.today().isoformat())
    print("=" * 60)

    # ── 1. indices ──
    print("\n── 主要指数 ──")
    idx = ak.safe_fetch(ak.fetch_index_spot, "指数")
    if idx is not None:
        for _, row in idx.iterrows():
            direction = "🔴" if row["change"] < 0 else "🟢"
            print(f"  {direction} {row['name']:<8s}  {row['price']:>10.2f}  {row['change']:>+6.2f}%")
    else:
        print("  （连接被拒——关掉 VPN 后重试）")

    # ── 2. my portfolio TODAY ──
    print(f"\n── 我的持仓今日表现 ──")
    my_data = ak.safe_fetch(
        lambda: ak.fetch_my_fund_data(codes, fund_map), "我的基金"
    )
    if my_data is not None:
        total_weighted = 0.0
        for _, row in my_data.iterrows():
            name = row.get("my_name", row["name"])
            daily_ret = row.get("daily_return", 0) or 0
            code = row.get("code", "")
            # Find this fund in portfolio for weighting
            h = next((h for h in portfolio.holdings if h.code == code), None)
            direction = "🔴" if daily_ret < 0 else "🟢"
            print(
                f"  {direction} {name[:28]:<30s}  {daily_ret:>+6.2f}%  "
                f"净值 {row['nav']}"
            )
            if h:
                total_weighted += daily_ret * h.amount / portfolio.total_value
        print(f"  {'─' * 50}")
        print(f"  今日估计：{total_weighted:+.2f}%  →  ¥{portfolio.total_value * total_weighted / 100:+,.0f}")
        # Show missing funds
        found_codes = set(my_data["code"].tolist())
        missing = [h for h in portfolio.holdings if h.code not in found_codes]
        if missing:
            print(f"  ⚠️ 无估算数据：{', '.join(h.name[:12] for h in missing)}")
    else:
        print("  （基金数据获取失败）")

    # ── 3. sector fund flow (THS) ──
    print(f"\n── 板块资金流向（同花顺）──")
    flow = ak.safe_fetch(ak.fetch_sector_fund_flow, "资金流向")
    if flow is not None and len(flow) > 0:
        print("  🔥 净流入 TOP 5：")
        for _, r in flow.head(5).iterrows():
            print(
                f"     {r['name']:<12s}  {r['change']:>+5.2f}%  "
                f"净流入 {r['net_flow']:>7.2f}亿  {int(r['up_count'])}↑{int(r['down_count'])}↓"
            )
        print("  💧 净流出 TOP 5：")
        for _, r in flow.tail(5).iterrows():
            print(
                f"     {r['name']:<12s}  {r['change']:>+5.2f}%  "
                f"净流出 {r['net_flow']:>7.2f}亿  {int(r['up_count'])}↑{int(r['down_count'])}↓"
            )

        # My relevant sectors
        print(f"\n── 我关注的板块 ──")
        my_boards = ak.fetch_my_sectors()
        for _, r in my_boards.iterrows():
            d = "🔴" if r["change"] < 0 else "🟢"
            print(
                f"  {d} {r['name']:<12s}  {r['change']:>+5.2f}%  "
                f"净{'流入' if r['net_flow'] > 0 else '流出'} {abs(r['net_flow']):.1f}亿"
            )

    # ── 4. consecutive days ──
    print(f"\n── 核心板块连涨/连跌 ──")
    for sect in ["半导体", "贵金属"]:
        try:
            streak = ak.fetch_sector_consecutive_days(sect)
            if isinstance(streak, dict) and "error" not in streak:
                arrow = "🔺" if streak["direction"] == "涨" else "🔻"
                print(
                    f"  {arrow} {sect:<8s}  连{streak['direction']} "
                    f"{streak['streak']} 天  今日 {streak['today_change']:+.2f}%"
                )
            else:
                print(f"  ⚠️ {sect}: {streak}")
        except Exception as e:
            print(f"  ⚠️ {sect}: {type(e).__name__}: {e}")

    # ── 4. top/bottom funds today ──
    print(f"\n── 今日涨幅 TOP 10（全部基金）──")
    top = ak.safe_fetch(lambda: ak.fetch_top_funds(10), "涨幅榜")
    if top is not None:
        for _, row in top.iterrows():
            print(f"  🟢 {row['name'][:30]:<32s}  {row['daily_return']:>+6.2f}%")
    else:
        print("  （数据获取失败）")

    print(f"\n── 今日跌幅 TOP 10（全部基金）──")
    bot = ak.safe_fetch(lambda: ak.fetch_bottom_funds(10), "跌幅榜")
    if bot is not None:
        for _, row in bot.iterrows():
            print(f"  🔴 {row['name'][:30]:<32s}  {row['daily_return']:>+6.2f}%")
    else:
        print("  （数据获取失败）")

    print()
    print("=" * 60)
    print("  `python3 cli.py diagnose` → 持仓诊断")
    print("  `python3 cli.py check-rules` → 止损检查")
    print("=" * 60)
    print()


# ═══════════════════════════════════════════════════════════
# main
# ═══════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(description="Fund Agent — 个人基金决策教练")
    sub = parser.add_subparsers(dest="cmd")

    sub.add_parser("market", help="今日市场总览 + 我的基金涨跌")
    sub.add_parser("diagnose", help="运行持仓诊断")
    sub.add_parser("init-rules", help="初始化默认止损/风控规则")
    sub.add_parser("check-rules", help="检查所有规则")
    sub.add_parser("list-rules", help="列出所有规则")

    args = parser.parse_args()

    portfolio_path = os.path.join(PROJECT_DIR, "data", "portfolio.json")
    rules_path = os.path.join(PROJECT_DIR, "data", "rules.json")

    if args.cmd == "market":
        cmd_market(portfolio_path)
    elif args.cmd == "diagnose":
        cmd_diagnose(portfolio_path)
    elif args.cmd == "init-rules":
        cmd_init_rules(rules_path)
    elif args.cmd == "check-rules":
        cmd_check_rules(rules_path, portfolio_path)
    elif args.cmd == "list-rules":
        engine = RulesEngine(rules_path)
        cmd_list_rules(engine)
    else:
        # default: full check = diagnose + rules
        cmd_diagnose(portfolio_path)
        if os.path.exists(rules_path):
            cmd_check_rules(rules_path, portfolio_path)
        else:
            print("💡 运行 `python3 cli.py init-rules` 初始化止损规则\n")


if __name__ == "__main__":
    main()
