"""Portfolio diagnosis engine. Computes industry exposure, overlap, risk."""

import numpy as np
from src.data.portfolio import Portfolio, FundHolding


# ── industry classification ──────────────────────────────

# Maps user-defined sectors to broader industry categories for diagnosis
SECTOR_TO_INDUSTRY: dict[str, str] = {
    "创业板人工智能": "科技/AI",
    "中证半导体": "科技/半导体",
    "科创芯片设计": "科技/半导体",
    "存储芯片": "科技/半导体",
    "CPO": "科技/AI",
    "中证机器人": "科技/硬件",
    "商业航天": "航天/国防",
    "中证卫星产业": "航天/国防",
    "有色金属矿业": "原材料/矿业",
    "上海金": "贵金属",
    "黄金 9999": "贵金属",
    "黄金9999": "贵金属",
    "新兴市场优选": "海外/新兴市场",
    "锂矿": "原材料/矿业",
}


def classify_industry(sector: str) -> str:
    return SECTOR_TO_INDUSTRY.get(sector, "其他")


# ── industry exposure ─────────────────────────────────────

def compute_industry_exposure(portfolio: Portfolio) -> dict[str, dict]:
    """Aggregate holdings into industry-level exposure."""
    industries: dict[str, dict] = {}
    for h in portfolio.holdings:
        ind = classify_industry(h.sector)
        if ind not in industries:
            industries[ind] = {"amount": 0, "funds": [], "profit": 0}
        industries[ind]["amount"] += h.amount
        industries[ind]["funds"].append(h.name)
        industries[ind]["profit"] += h.profit or 0

    total = portfolio.total_value
    for ind in industries:
        industries[ind]["pct"] = round(industries[ind]["amount"] / total * 100, 1)
        industries[ind]["fund_count"] = len(industries[ind]["funds"])

    return dict(sorted(industries.items(), key=lambda x: -x[1]["pct"]))


# ── overlap analysis ──────────────────────────────────────

def compute_overlap_groups(portfolio: Portfolio) -> list[dict]:
    """Identify groups of funds that likely overlap.

    Two levels:
    1. Same sub-sector (exact match) — high confidence overlap
    2. Same industry (mapped via SECTOR_TO_INDUSTRY) — medium confidence
    """
    from collections import defaultdict

    # Level 1: same exact sector
    by_sector: dict[str, list[FundHolding]] = defaultdict(list)
    for h in portfolio.holdings:
        by_sector[h.sector].append(h)

    overlaps = []
    seen_names: set[str] = set()

    for sector, funds in by_sector.items():
        if len(funds) >= 2:
            total = sum(f.amount for f in funds)
            fund_names = [f.name for f in funds]
            overlaps.append({
                "sector": sector,
                "industry": classify_industry(sector),
                "level": "同一细分赛道",
                "fund_count": len(funds),
                "total_amount": total,
                "funds": fund_names,
                "amounts": [f.amount for f in funds],
                "severity": "🟡 中" if len(funds) == 2 else "🔴 高",
            })
            seen_names.update(fund_names)

    # Level 2: same industry but different sectors
    by_industry: dict[str, list[FundHolding]] = defaultdict(list)
    for h in portfolio.holdings:
        by_industry[classify_industry(h.sector)].append(h)

    for industry, funds in by_industry.items():
        if len(funds) >= 3:
            # Only report industry-level if the funds span multiple sectors
            sectors_in_industry = set(h.sector for h in funds)
            if len(sectors_in_industry) >= 2:
                # Exclude funds already reported at sector level
                unreported = [h for h in funds if h.name not in seen_names]
                if len(unreported) >= 2:
                    total = sum(h.amount for h in funds)
                    overlaps.append({
                        "sector": f"{industry}（跨细分赛道）",
                        "industry": industry,
                        "level": "同一行业大类",
                        "fund_count": len(funds),
                        "total_amount": total,
                        "funds": [f"{h.name} [{h.sector}]" for h in funds],
                        "amounts": [h.amount for h in funds],
                        "severity": "🟡 关注",
                    })

    return sorted(overlaps, key=lambda x: -x["total_amount"])


# ── concentration risk ────────────────────────────────────

def compute_concentration(portfolio: Portfolio) -> dict:
    """Compute concentration metrics."""
    amounts = sorted([h.amount for h in portfolio.holdings], reverse=True)
    total = portfolio.total_value

    top1 = amounts[0] / total * 100 if amounts else 0
    top3 = sum(amounts[:3]) / total * 100 if amounts else 0
    top5 = sum(amounts[:5]) / total * 100 if amounts else 0

    # Herfindahl-Hirschman Index (sector level)
    industries = compute_industry_exposure(portfolio)
    hhi = sum(v["pct"] ** 2 for v in industries.values())

    return {
        "top1_holding_pct": round(top1, 1),
        "top3_holding_pct": round(top3, 1),
        "top5_holding_pct": round(top5, 1),
        "hhi": round(hhi, 0),
        "effective_diversification": round(10000 / hhi, 1) if hhi > 0 else 0,
    }


# ── risk assessment ───────────────────────────────────────

def assess_risk(
    portfolio: Portfolio, user_max_drawdown_tolerance: float = 0.15
) -> dict:
    """Qualitative risk assessment based on portfolio structure."""
    industries = compute_industry_exposure(portfolio)

    # Find the dominant industry
    dominant_pct = max(v["pct"] for v in industries.values())
    dominant_name = max(industries.items(), key=lambda x: x[1]["pct"])[0]

    # Defense: bonds + gold
    defensive_pct = sum(
        v["pct"] for k, v in industries.items()
        if k in ("债券/货币", "贵金属")
    )

    # Tech exposure
    tech_pct = sum(
        v["pct"] for k, v in industries.items()
        if k.startswith("科技")
    )

    # Risk flags
    flags = []
    if dominant_pct > 50:
        flags.append(f"⚠️ 单一行业集中度过高（{dominant_name} {dominant_pct}%）")
    if defensive_pct < 5:
        flags.append("🔴 无防御性资产（债券/货币为 0%）")
    if tech_pct > 60:
        flags.append(f"⚠️ 科技仓位过高（{tech_pct}%），一次板块回调可能造成大幅回撤")
    if portfolio.fund_count > 10:
        flags.append("⚠️ 持仓碎片化（>10 只基金），部分仓位对总收益贡献极小")

    # Estimated max drawdown (rough heuristic)
    # Tech-heavy portfolio: ~25% max drawdown; diversified: ~15%
    estimated_drawdown = 0.25 if tech_pct > 50 else 0.15

    status = "OK"
    if estimated_drawdown > user_max_drawdown_tolerance:
        status = "⚠️ 超出承受力"
    if defensive_pct < 5 and tech_pct > 60:
        status = "🔴 高风险"

    return {
        "dominant_industry": dominant_name,
        "dominant_pct": dominant_pct,
        "tech_pct": tech_pct,
        "defensive_pct": defensive_pct,
        "estimated_max_drawdown": estimated_drawdown,
        "user_tolerance": user_max_drawdown_tolerance,
        "status": status,
        "flags": flags,
    }
