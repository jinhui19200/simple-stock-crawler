#!/usr/bin/env python3
"""Build and cache the official industry-ETF universe."""

from __future__ import annotations

import json
import re
import time
from datetime import date, datetime
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode

from update import (
    PE,
    PRICE,
    eastmoney_kline_request,
    read_json,
    request_json,
    update_pe,
    write_json,
)

ROOT = Path(__file__).resolve().parent
MAPPING = ROOT / "etf_mapping.json"
CATALOG = ROOT / "candidate_catalog.json"
CANDIDATE_SEED = ROOT / "candidate_seed.json"
INDEX_SEED = ROOT / "index_metadata_seed.json"
UNIVERSE_REPORT = ROOT / "output" / "universe_report.json"
PROFILE_URL = "https://fundmobapi.eastmoney.com/FundMNewApi/FundMNNBasicInformation"
MIN_MARKET_CAP = 1_000_000_000
MAX_UNIVERSE = 100

BROAD_OR_NON_STOCK = re.compile(
    r"沪深300|中证(?:500|800|1000|2000|A50|A100|A500)|上证(?:50|180|380)|"
    r"深证(?:100|成指)|创业板指(?!数科技)|科创(?:50|100|200)|北证50|"
    r"MSCI中国|富时中国|红利|低波|价值|成长|基本面|质量|增强|等权|"
    r"自由现金流|货币|黄金|白银|豆粕|国债|债券|信用债|可转债|公司债|"
    r"短融|城投|REIT|FOF",
    re.I,
)

CATEGORY_PATTERNS = [
    ("半导体与芯片", r"半导体|芯片|集成电路|科创芯片"),
    ("人工智能与软件", r"人工智能|软件|云计算|大数据|计算机|信创|数字经济|机器人"),
    ("通信与电子", r"通信|消费电子|电子|光通信|物联网"),
    ("新能源与电力设备", r"新能源|光伏|电池|锂电|储能|电力设备|智能电网|绿色电力|风电|电力"),
    ("汽车与智能驾驶", r"汽车|智能车|新能源车|智能驾驶"),
    ("医药与医疗", r"医药|医疗|创新药|生物科技|疫苗|中药"),
    ("金融", r"证券|银行|保险|金融科技|非银金融"),
    ("消费", r"消费|酒|食品饮料|家电|旅游|酒店|餐饮|零售|养殖|畜牧|农业"),
    ("能源与资源", r"煤炭|油气|石油|能源化工|有色|稀土|钢铁|化工|矿业|资源"),
    ("国防军工与航空", r"军工|国防|航空|航天|卫星"),
    ("工业制造", r"机械|高端装备|工业母机|智能制造|工程机械|基建|建材|建筑"),
    ("传媒与文娱", r"传媒|游戏|影视|动漫|文娱"),
    ("环保", r"环保|碳中和|低碳|生态"),
    ("房地产", r"房地产|地产"),
    ("港股行业主题", r"港股|恒生|中概|互联网"),
]


def classify(name: str, tracking_index: str = "") -> str:
    text = f"{name} {tracking_index}"
    for category, pattern in CATEGORY_PATTERNS:
        if re.search(pattern, text, re.I):
            return category
    return "其他行业主题"


def is_broad(name: str, tracking_index: str) -> bool:
    return bool(BROAD_OR_NON_STOCK.search(f"{name} {tracking_index}"))


def is_stock_etf(fund_type: str) -> bool:
    excluded = ("债券", "货币", "商品", "QDII", "REIT", "FOF", "混合")
    return (
        "股票" in fund_type
        and not any(word in fund_type for word in excluded)
    )


def eligible_profile(
    code: str,
    name: str,
    market_cap: float,
    profile: dict,
) -> tuple[bool, str]:
    if not re.fullmatch(r"(?:5\d{5}|159\d{3})", code):
        return False, "非A股场内ETF代码"
    if market_cap < MIN_MARKET_CAP:
        return False, "市值低于10亿元"
    if not is_stock_etf(str(profile.get("fundType") or "")):
        return False, f"非股票型ETF：{profile.get('fundType') or '未知'}"
    tracking_name = str(profile.get("trackingIndex") or "")
    if not profile.get("trackingIndexCode"):
        return False, "未取得跟踪指数代码"
    if is_broad(name, tracking_name):
        return False, "宽基或非行业主题"
    return True, ""


def deduplicate_candidates(candidates: Iterable[dict]) -> list[dict]:
    """Keep the largest ETF for every tracking index."""
    selected, seen = [], set()
    for item in sorted(candidates, key=lambda row: (-float(row["marketCap"]), row["code"])):
        index_code = str(item.get("trackingIndexCode") or "")
        if not index_code or index_code in seen:
            continue
        seen.add(index_code)
        selected.append(item)
    return selected


def latest_market_trading_date(cutoff: date) -> str:
    """Read the Shanghai Composite calendar from Eastmoney."""
    start = date.fromordinal(max(date(2000, 1, 1).toordinal(), cutoff.toordinal() - 20))
    query = urlencode(
        {
            "secid": "1.000001",
            "klt": "101",
            "fqt": "0",
            "ut": "7eea3edcaed734bea9cbfc24409ed989",
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56",
            "beg": start.strftime("%Y%m%d"),
            "end": cutoff.strftime("%Y%m%d"),
        }
    )
    payload, _source = eastmoney_kline_request(
        query,
        {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://quote.eastmoney.com/sh000001.html",
        },
    )
    days = [
        str(line).split(",", 1)[0]
        for line in ((payload.get("data") or {}).get("klines") or [])
    ]
    if not days:
        raise RuntimeError("上证指数没有返回交易日")
    return sorted(days)[-1]


def fetch_spot_candidates() -> list[dict]:
    import akshare as ak

    frame = ak.fund_etf_spot_em()
    required = {"代码", "名称", "总市值"}
    missing = required.difference(frame.columns)
    if missing:
        raise RuntimeError(f"东方财富ETF行情缺少字段：{','.join(sorted(missing))}")
    result = []
    for _, row in frame.iterrows():
        code = str(row["代码"]).zfill(6)
        cap = float(row["总市值"])
        if re.fullmatch(r"(?:5\d{5}|159\d{3})", code) and cap >= MIN_MARKET_CAP:
            result.append(
                {
                    "code": code,
                    "name": str(row["名称"]),
                    "marketCap": cap,
                }
            )
    return sorted(result, key=lambda item: (-item["marketCap"], item["code"]))


def fetch_profile(code: str) -> dict:
    query = urlencode(
        {
            "FCODE": code,
            "deviceid": "Wap",
            "plat": "Wap",
            "product": "EFund",
            "version": "2.0.0",
        }
    )
    payload = request_json(
        PROFILE_URL + "?" + query,
        {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://fund.eastmoney.com/",
        },
    )
    data = payload.get("Datas") or {}
    index_info = (payload.get("Expansion") or {}).get("INDEXINFO") or {}
    return {
        "fundType": str(data.get("FTYPE") or ""),
        "listed": str(data.get("ISLISTTRADE") or "") == "1",
        "trackingIndexCode": str(data.get("INDEXCODE") or "").strip(),
        "trackingIndex": str(data.get("INDEXNAME") or "").strip(),
        "trackingIndexMaker": str(index_info.get("MAKERNAME") or "未返回"),
        "profileCheckedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
    }


def load_catalog() -> dict[str, dict]:
    catalog = read_json(CATALOG, {})
    if isinstance(catalog, dict) and isinstance(catalog.get("etfs"), dict):
        return catalog["etfs"]

    result: dict[str, dict] = {}
    for item in read_json(MAPPING, []):
        code = str(item.get("code") or "")
        if code:
            result[code] = {
                **item,
                "marketCap": float(item.get("marketCap") or 0),
            }
    for item in read_json(INDEX_SEED, []):
        code = str(item.get("code") or "")
        if not code:
            continue
        result[code] = {
            **result.get(code, {}),
            "name": item.get("name") or result.get(code, {}).get("name") or code,
            "fundType": item.get("type") or result.get(code, {}).get("fundType") or "",
            "category": item.get("category") or result.get(code, {}).get("category") or "",
            "trackingIndexCode": item.get("trackingIndexCode") or result.get(code, {}).get("trackingIndexCode") or "",
            "trackingIndex": item.get("trackingIndex") or result.get(code, {}).get("trackingIndex") or "",
            "trackingIndexMaker": item.get("indexMaker") or result.get(code, {}).get("trackingIndexMaker") or "",
            "marketCap": float(result.get(code, {}).get("marketCap") or (item.get("scale_yi") or 0) * 1e8),
        }
    for item in read_json(CANDIDATE_SEED, []):
        code = str(item.get("code") or "")
        if not code:
            continue
        result[code] = {
            "code": code,
            "name": item.get("name") or code,
            "category": item.get("category") or "",
            "marketCap": float((item.get("scale_yi") or 0) * 1e8),
            **result.get(code, {}),
        }
    return result


def save_catalog(catalog: dict[str, dict]) -> None:
    write_json(
        CATALOG,
        {
            "updatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
            "etfs": catalog,
        },
    )


def _probe_pe(index_code: str, checked_at: str) -> tuple[bool, str, str]:
    saved = read_json(PE / f"{index_code}.json", {})
    points = saved.get("points") if isinstance(saved.get("points"), list) else []
    if points:
        return True, str(points[-1]["date"]), ""
    try:
        status, latest = update_pe(index_code, True, date.today())
        available = bool(latest) and status not in {"失败", "官方无新增"}
        return available, latest, "" if available else status
    except Exception as exc:
        return False, "", str(exc)


def select_universe(
    spot: list[dict],
    catalog: dict[str, dict],
    *,
    limit: int = MAX_UNIVERSE,
) -> tuple[list[dict], dict]:
    selected, seen_indexes, rejected = [], set(), {}
    profile_requests = 0
    pe_requests = 0
    for spot_item in sorted(spot, key=lambda row: (-float(row["marketCap"]), row["code"])):
        code, name, market_cap = (
            spot_item["code"],
            spot_item["name"],
            float(spot_item["marketCap"]),
        )
        if market_cap < MIN_MARKET_CAP or is_broad(name, ""):
            continue
        cached = catalog.get(code, {})
        profile = {
            "fundType": cached.get("fundType"),
            "trackingIndexCode": cached.get("trackingIndexCode"),
            "trackingIndex": cached.get("trackingIndex"),
            "trackingIndexMaker": cached.get("trackingIndexMaker"),
        }
        if not profile["trackingIndexCode"] or not profile["fundType"]:
            try:
                fetched = fetch_profile(code)
                profile_requests += 1
                profile = {**profile, **fetched}
                time.sleep(0.12)
            except Exception as exc:
                rejected[code] = f"基金资料读取失败：{exc}"
                continue

        ok, reason = eligible_profile(code, name, market_cap, profile)
        catalog[code] = {
            **cached,
            **profile,
            "code": code,
            "name": name,
            "marketCap": market_cap,
            "category": cached.get("category") or classify(name, profile["trackingIndex"]),
            "profileStatus": "ok" if ok else "rejected",
            "profileError": "" if ok else reason,
        }
        if not ok:
            rejected[code] = reason
            continue
        index_code = str(profile["trackingIndexCode"])
        if index_code in seen_indexes:
            rejected[code] = f"跟踪指数重复：{index_code}"
            continue

        if "trackingPeAvailable" not in cached:
            available, latest_pe, pe_error = _probe_pe(index_code, profile.get("profileCheckedAt") or "")
            pe_requests += 1
            cached_pe = {
                "trackingPeAvailable": available,
                "latestPeDate": latest_pe,
                "peCheckedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                "peCheckError": pe_error,
            }
            catalog[code].update(cached_pe)
        else:
            cached_pe = cached
        if not catalog[code].get("trackingPeAvailable"):
            rejected[code] = catalog[code].get("peCheckError") or "官方历史PETTM不可用"
            continue

        seen_indexes.add(index_code)
        selected.append(
            {
                "code": code,
                "name": name,
                "category": catalog[code]["category"],
                "trackingIndexCode": index_code,
                "trackingIndex": profile["trackingIndex"],
                "trackingIndexMaker": profile["trackingIndexMaker"],
                "marketCap": market_cap,
                "size": f"{market_cap / 1e8:.1f} 亿",
                "trackingPeAvailable": True,
                "selectionRank": len(selected) + 1,
                "status": "ready",
            }
        )
        if len(selected) >= limit:
            break
    return selected, {
        "profileRequests": profile_requests,
        "peRequests": pe_requests,
        "rejected": rejected,
    }


def refresh_universe(
    *,
    selection_date: date,
    limit: int = MAX_UNIVERSE,
) -> tuple[list[dict], dict]:
    catalog = load_catalog()
    spot = fetch_spot_candidates()
    selected, details = select_universe(spot, catalog, limit=limit)
    save_catalog(catalog)
    if not selected:
        raise RuntimeError("没有找到同时满足规模、类型和官方PETTM条件的ETF")
    for item in selected:
        item["selectionDate"] = selection_date.isoformat()

    report = {
        "selectionDate": selection_date.isoformat(),
        "spotCandidates": len(spot),
        "selected": len(selected),
        "uniqueTrackingIndexes": len({item["trackingIndexCode"] for item in selected}),
        "profileRequests": details["profileRequests"],
        "peRequests": details["peRequests"],
        "rejected": details["rejected"],
        "catalogSize": len(catalog),
    }
    write_json(UNIVERSE_REPORT, report)
    write_json(MAPPING, selected)
    return selected, report
