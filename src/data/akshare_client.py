"""AKShare data client. Pulls live fund/market data — no manual input needed.

Requires: pip install akshare
Data sources: 东方财富 (eastmoney) via AKShare
"""

import time
from datetime import date
from typing import Optional

import pandas as pd
import numpy as np


# ── fund data (daily rankings, NAV, returns) ──────────────

def fetch_fund_rankings(symbol: str = "全部") -> pd.DataFrame:
    """All fund daily rankings: NAV, daily return, 1w/1m/3m/6m/1y returns.

    ~19,000+ funds. Use symbol to filter: '股票型','混合型','债券型','全部' etc.
    """
    import akshare as ak

    df = ak.fund_open_fund_rank_em(symbol=symbol)
    cols = {
        "基金代码": "code",
        "基金简称": "name",
        "日期": "date",
        "单位净值": "nav",
        "累计净值": "cum_nav",
        "日增长率": "daily_return",
        "近1周": "ret_1w",
        "近1月": "ret_1m",
        "近3月": "ret_3m",
        "近6月": "ret_6m",
        "近1年": "ret_1y",
        "今年来": "ret_ytd",
        "成立来": "ret_all",
        "手续费": "fee",
    }
    df = df.rename(columns=cols)
    df["daily_return"] = pd.to_numeric(df["daily_return"], errors="coerce")
    df["nav"] = pd.to_numeric(df["nav"], errors="coerce")
    return df[list(cols.values())]


def fetch_top_funds(n: int = 20, symbol: str = "全部") -> pd.DataFrame:
    """Top N funds by daily return."""
    df = fetch_fund_rankings(symbol)
    return df.nlargest(n, "daily_return")


def fetch_bottom_funds(n: int = 20, symbol: str = "全部") -> pd.DataFrame:
    """Bottom N funds by daily return."""
    df = fetch_fund_rankings(symbol)
    return df.nsmallest(n, "daily_return")


FUND_COLUMNS = ["code", "name", "my_name", "date", "source", "nav", "daily_return"]


def normalize_fund_code(value) -> str:
    """Keep leading zeroes even when a provider returns integer codes."""
    text = str(value).strip()
    if text.endswith(".0"):
        text = text[:-2]
    return text.zfill(6) if text.isdigit() else text


def _valid_fund_rows(frame: pd.DataFrame, today: date) -> pd.DataFrame:
    frame = frame.copy()
    frame["nav"] = pd.to_numeric(frame["nav"], errors="coerce")
    frame["daily_return"] = pd.to_numeric(frame["daily_return"], errors="coerce")
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce", format="mixed").dt.date
    valid = (np.isfinite(frame["nav"]) & (frame["nav"] > 0)
             & np.isfinite(frame["daily_return"]) & frame["date"].notna()
             & (frame["date"] <= today))
    return (frame.loc[valid].sort_values("date", ascending=False)
            .drop_duplicates("code", keep="first"))


def fetch_my_fund_data(
    codes: list[str], fund_map: dict[str, str]
) -> pd.DataFrame:
    """Use today's valid estimates, then fill missing funds with dated NAVs.

    Either source can fail without discarding useful rows from the other.
    Source failures and unresolved codes are retained in DataFrame.attrs.
    """
    requested = list(dict.fromkeys(normalize_fund_code(code) for code in codes if str(code).strip()))
    names = {normalize_fund_code(code): name for code, name in fund_map.items()}
    result = pd.DataFrame(columns=FUND_COLUMNS)
    warnings = []
    today = pd.Timestamp.now(tz="Asia/Shanghai").date()
    if not requested:
        result.attrs.update(warnings=[], missing_codes=[])
        return result

    import akshare as ak

    try:
        frame = ak.fund_value_estimation_em(symbol="全部").copy()
        frame["code"] = frame["基金代码"].map(normalize_fund_code)
        frame = frame[frame["code"].isin(requested)].copy()
        frame["daily_return"] = frame[f"{today}-估算数据-估算增长率"].astype(str).str.replace("%", "", regex=False)
        frame["nav"] = frame[f"{today}-估算数据-估算值"]
        frame["date"] = today
        frame["source"] = "盘中估算"
        frame["my_name"] = frame["code"].map(names)
        frame["name"] = frame["my_name"].fillna(frame["基金名称"])
        result = _valid_fund_rows(frame[FUND_COLUMNS], today)
    except Exception as exc:
        warnings.append(f"盘中估算不可用：{type(exc).__name__}: {str(exc)[:100]}")

    missing = set(requested) - set(result["code"])
    if missing:
        try:
            frame = fetch_fund_rankings().copy()
            frame["code"] = frame["code"].map(normalize_fund_code)
            frame = frame[frame["code"].isin(missing)].copy()
            frame["source"] = "已公布净值"
            frame["my_name"] = frame["code"].map(names)
            frame["name"] = frame["my_name"].fillna(frame["name"])
            confirmed = _valid_fund_rows(frame[FUND_COLUMNS], today)
            result = pd.concat([result, confirmed], ignore_index=True)
        except Exception as exc:
            warnings.append(f"已公布净值补全失败：{type(exc).__name__}: {str(exc)[:100]}")

    if result.empty and warnings:
        raise RuntimeError("；".join(warnings))
    order = {code: i for i, code in enumerate(requested)}
    result = result.sort_values("code", key=lambda values: values.map(order)).reset_index(drop=True)
    result.attrs.update(warnings=warnings, missing_codes=[code for code in requested if code not in set(result["code"])])
    return result


# ── market indices ────────────────────────────────────────

def fetch_index_spot() -> pd.DataFrame:
    """A-share index spot prices. Uses Sina source (works without VPN)."""
    import akshare as ak

    fetcher = getattr(ak, "index_zh_spot_sina", None)
    if fetcher is None:
        fetcher = ak.stock_zh_index_spot_sina
    df = fetcher()
    key_names = ["上证指数", "深证成指", "创业板指", "科创50", "沪深300"]
    result = df[df["名称"].isin(key_names)][
        ["名称", "最新价", "涨跌幅"]
    ].rename(columns={"名称": "name", "最新价": "price", "涨跌幅": "change"})
    result["change"] = result["change"].astype(float)
    return result


# ── sector / board data (THS 同花顺 source) ──────────────

def fetch_sector_fund_flow() -> pd.DataFrame:
    """Sector fund flow: which sectors are getting money in/out today.

    Returns top inflows and outflows from the THS industry board data.
    """
    df = fetch_industry_board()
    return df[["name", "change", "net_flow", "up_count", "down_count"]].sort_values(
        "net_flow", ascending=False
    )


def fetch_sector_consecutive_days(sector_name: str, lookback: int = 30) -> dict:
    """Calculate consecutive up/down days for a sector using THS history.

    Args:
        sector_name: name matching the THS board (e.g. '半导体', '人工智能')
        lookback: how many trading days to look back
    """
    import akshare as ak

    from datetime import date, timedelta

    end = date.today().isoformat()
    start = (date.today() - timedelta(days=lookback * 2)).isoformat()

    try:
        hist = ak.stock_board_industry_index_ths(
            symbol=sector_name, start_date=start, end_date=end
        )
    except Exception:
        return {"error": f"无法获取{sector_name}历史数据"}

    if len(hist) < 2:
        return {"error": "数据不足"}

    # Compute daily change from close price
    hist = hist.sort_values("日期")
    hist["change"] = hist["收盘价"].pct_change() * 100
    hist = hist.sort_values("日期", ascending=False)
    changes = hist["change"].tolist()

    streak = 1
    direction = "涨" if changes[0] > 0 else "跌" if changes[0] < 0 else "平"

    for i in range(1, len(changes)):
        prev = changes[i - 1]
        curr = changes[i]
        if direction == "涨" and curr > 0:
            streak += 1
        elif direction == "跌" and curr < 0:
            streak += 1
        else:
            break

    return {
        "sector": sector_name,
        "date": str(hist.iloc[0]["日期"]),
        "direction": direction,
        "streak": streak,
        "today_change": changes[0],
        "recent_changes": changes[:streak],
    }


MY_SECTORS = [
    "半导体", "消费电子", "通信设备", "其他电源设备",
    "贵金属", "工业金属", "小金属", "自动化设备",
    "军工装备", "军工电子", "航天装备",
]


_industry_cache: Optional[pd.DataFrame] = None


def fetch_industry_board() -> pd.DataFrame:
    """Industry sector spot data from THS. Result cached for the session."""
    global _industry_cache
    if _industry_cache is not None:
        return _industry_cache

    import akshare as ak

    df = ak.stock_board_industry_summary_ths()
    df = df.rename(columns={
        "板块": "name",
        "涨跌幅": "change",
        "净流入": "net_flow",
        "上涨家数": "up_count",
        "下跌家数": "down_count",
        "领涨股": "leader",
        "领涨股-涨跌幅": "leader_change",
    })
    df["change"] = df["change"].astype(float)
    df["net_flow"] = df["net_flow"].astype(float)
    _industry_cache = df
    return df


def fetch_my_sectors() -> pd.DataFrame:
    """Filter industry board to sectors relevant to my portfolio."""
    df = fetch_industry_board()  # uses cache
    return df[df["name"].apply(lambda x: any(s in x for s in MY_SECTORS))]


# ── relevant boards for the user's portfolio ──────────────

MY_SECTORS = [
    "人工智能", "半导体", "芯片", "存储芯片", "CPO",
    "机器人", "商业航天", "卫星", "黄金", "有色金属",
    "锂矿", "新兴市场",
]


def fetch_my_relevant_boards() -> pd.DataFrame:
    """Pull concept board data only for sectors relevant to my portfolio."""
    df = fetch_concept_boards()
    relevant = df[df["name"].apply(
        lambda x: any(s in x for s in MY_SECTORS)
    )]
    return relevant.sort_values("change", ascending=False)


# ── safe wrapper ──────────────────────────────────────────

def safe_fetch(func, label: str, **kwargs) -> Optional[pd.DataFrame]:
    """Call a fetch function safely. Returns None on failure instead of crashing."""
    try:
        result = func(**kwargs)
        if result is not None and len(result) > 0:
            return result
        print(f"  ⚠️ {label}: 返回空数据")
        return None
    except Exception as e:
        msg = str(e)[:80]
        if "Connection" in str(type(e).__name__) or "RemoteDisconnected" in msg:
            print(f"  ⚠️ {label}: 连接失败（请检查网络、代理或数据源可用性）")
        else:
            print(f"  ⚠️ {label}: {type(e).__name__}: {msg}")
        return None
