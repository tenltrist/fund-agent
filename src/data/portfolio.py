"""Portfolio data model. Represents the user's fund holdings."""

from dataclasses import dataclass, field
from typing import Optional
import json


@dataclass
class FundHolding:
    name: str
    code: str
    amount: float
    sector: str
    cost_basis: Optional[float] = None
    profit: Optional[float] = None
    profit_rate: Optional[float] = None


@dataclass
class Portfolio:
    holdings: list[FundHolding] = field(default_factory=list)

    @property
    def total_value(self) -> float:
        return sum(h.amount for h in self.holdings)

    @property
    def total_profit(self) -> float:
        return sum(h.profit or 0 for h in self.holdings)

    @property
    def fund_count(self) -> int:
        return len(self.holdings)

    def sector_exposure(self) -> dict[str, dict]:
        """Calculate exposure per sector."""
        sectors: dict[str, dict] = {}
        for h in self.holdings:
            if h.sector not in sectors:
                sectors[h.sector] = {"amount": 0, "funds": [], "profit": 0}
            sectors[h.sector]["amount"] += h.amount
            sectors[h.sector]["funds"].append(h.name)
            sectors[h.sector]["profit"] += h.profit or 0

        total = self.total_value
        for s in sectors:
            sectors[s]["pct"] = round(sectors[s]["amount"] / total * 100, 1)

        return sectors

    def small_positions(self, threshold_pct: float = 5.0) -> list[FundHolding]:
        """Find positions below the threshold percentage of total."""
        threshold = self.total_value * threshold_pct / 100
        return [h for h in self.holdings if h.amount < threshold]

    def profit_leaders(self, top_n: int = 5) -> list[FundHolding]:
        """Top N funds by profit amount."""
        return sorted(
            self.holdings, key=lambda h: h.profit or 0, reverse=True
        )[:top_n]

    def profit_losers(self, top_n: int = 5) -> list[FundHolding]:
        """Bottom N funds by profit amount."""
        return sorted(
            self.holdings, key=lambda h: h.profit or 0
        )[:top_n]

    def to_dict(self) -> dict:
        return {
            "holdings": [
                {
                    "name": h.name,
                    "code": h.code,
                    "amount": h.amount,
                    "sector": h.sector,
                    "cost_basis": h.cost_basis,
                    "profit": h.profit,
                    "profit_rate": h.profit_rate,
                }
                for h in self.holdings
            ]
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Portfolio":
        holdings = [
            FundHolding(
                name=h["name"],
                code=h.get("code", ""),
                amount=h["amount"],
                sector=h.get("sector", ""),
                cost_basis=h.get("cost_basis"),
                profit=h.get("profit"),
                profit_rate=h.get("profit_rate"),
            )
            for h in data["holdings"]
        ]
        return cls(holdings=holdings)

    @classmethod
    def from_json(cls, path: str) -> "Portfolio":
        with open(path) as f:
            return cls.from_dict(json.load(f))

    def to_json(self, path: str) -> None:
        with open(path, "w") as f:
            json.dump(self.to_dict(), f, ensure_ascii=False, indent=2)
