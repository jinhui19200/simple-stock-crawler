#!/usr/bin/env python3
"""Publish validated local caches, including partial and stale status."""

from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parent
MAPPING = ROOT / "etf_mapping.json"
PRICE = ROOT / "output" / "etf_price"
PE = ROOT / "output" / "index_pe"
CONTEXT = ROOT / "output" / "run_context.json"
ETF_DATA = PROJECT / "data" / "etf"
DASHBOARD = PROJECT / "data" / "dashboard_universe.json"
REPORT = ROOT / "output" / "publish_report.json"
UPLOAD = PROJECT / "cloudflare-upload"
STATIC_FILES = ("index.html", "app.js", "styles.css", "nav.css", "strategy.css")


def read_json(path: Path, fallback):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return fallback


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(
        json.dumps(value, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    json.loads(temporary.read_text(encoding="utf-8"))
    temporary.replace(path)


def validate_prices(rows: list[dict]) -> list[dict]:
    cleaned, seen = [], set()
    for row in sorted(rows, key=lambda item: str(item.get("date") or "")):
        day = str(row.get("date") or "")[:10]
        if not day or day in seen:
            raise ValueError(f"日期为空或重复：{day or '-'}")
        opening, closing = float(row["open"]), float(row["close"])
        high, low = float(row["high"]), float(row["low"])
        if min(opening, closing, high, low) <= 0:
            raise ValueError(f"OHLC包含非正数：{day}")
        if not low <= min(opening, closing) <= max(opening, closing) <= high:
            raise ValueError(f"OHLC关系无效：{day}")
        cleaned.append(
            {
                "date": day,
                "open": opening,
                "high": high,
                "low": low,
                "close": closing,
            }
        )
        seen.add(day)
    if not cleaned:
        raise ValueError("日K缓存为空")
    return cleaned


def clean_pe(rows: list[dict]) -> list[dict]:
    points = {}
    for row in rows:
        try:
            day = str(row["date"])[:10]
            value = float(row.get("peTTM", row.get("pe_ttm")))
            if day >= "2016-01-01" and value > 0:
                points[day] = {"date": day, "pe_ttm": value}
        except (KeyError, TypeError, ValueError):
            continue
    return [points[day] for day in sorted(points)]


def percentile(points: list[dict]) -> str:
    if not points:
        return "--"
    values = [point["pe_ttm"] for point in points]
    latest = values[-1]
    rank = sum(value <= latest for value in values) / len(values) * 100
    return f"{rank:.1f}%"


def freshness_flags(
    latest_price_date: str,
    latest_pe_date: str,
    expected_trading_date: str,
    pe_required: bool,
) -> tuple[bool, str]:
    if not expected_trading_date:
        return True, f"尚未联网确认最新交易日；日K截至 {latest_price_date or '-'}"
    price_stale = bool(
        expected_trading_date and latest_price_date < expected_trading_date
    )
    pe_stale = bool(
        pe_required
        and expected_trading_date
        and (not latest_pe_date or latest_pe_date < expected_trading_date)
    )
    if price_stale:
        return True, f"日K截至 {latest_price_date}，预期 {expected_trading_date}"
    if pe_stale:
        return (
            True,
            f"PETTM截至 {latest_pe_date or '-'}，预期 {expected_trading_date}",
        )
    return False, ""


def main() -> None:
    mappings = read_json(MAPPING, [])
    if not isinstance(mappings, list) or not mappings:
        raise SystemExit("ETF映射文件为空")

    context = read_json(CONTEXT, {})
    expected = str(context.get("expectedTradingDate") or "")
    existing = read_json(DASHBOARD, {}).get("etfs", [])
    existing_by_code = {str(item.get("code")): item for item in existing}
    published_at = datetime.now().astimezone().isoformat(timespec="seconds")
    dashboard_rows, results = [], []

    for item in mappings:
        code = str(item["code"])
        index_code = str(item.get("trackingIndexCode") or "")
        previous = existing_by_code.get(code, {})
        try:
            price_cache = read_json(PRICE / f"{code}.json", {})
            if not price_cache.get("prices"):
                raise ValueError("没有可发布的日K缓存")
            prices = validate_prices(price_cache.get("prices", []))
            pe_cache = read_json(PE / f"{index_code}.json", {})
            valuation = clean_pe(pe_cache.get("points", []))
            latest_price_date = prices[-1]["date"]
            latest_pe_date = valuation[-1]["date"] if valuation else ""
            stale, stale_reason = freshness_flags(
                latest_price_date,
                latest_pe_date,
                expected,
                bool(item.get("trackingPeAvailable")),
            )
            unavailable_detail = None
            if not valuation:
                unavailable_detail = (
                    item.get("unavailableReason")
                    or "跟踪指数编制机构未公开免费的历史日度PETTM"
                )

            payload = {
                "symbol": code,
                "updated_at": published_at,
                "selection_date": item.get("selectionDate")
                or context.get("selectionDate"),
                "data_session": context.get("session") or "manual",
                "expected_trading_date": expected,
                "latest_price_date": latest_price_date,
                "latest_pe_date": latest_pe_date,
                "stale": stale,
                "stale_reason": stale_reason,
                "sources": {
                    "primary": price_cache.get("source")
                    or "东方财富前复权日K（本地缓存）",
                    "valuation": pe_cache.get("source")
                    or "跟踪指数官方历史PETTM未公开或暂不可用",
                },
                "tracking_index": item.get("trackingIndex") or "",
                "tracking_index_code": index_code,
                "valuation_index": index_code,
                "valuation_unavailable_reason": (
                    "跟踪指数官方未公开历史日度PETTM"
                    if not valuation
                    else None
                ),
                "valuation_unavailable_detail": unavailable_detail,
                "validation": {
                    "passed": True,
                    "checked_days": len(prices),
                    "issues": [],
                },
                "ohlc": prices,
                "valuation": valuation,
            }
            write_json(ETF_DATA / f"{code}.json", payload)

            first_close, last_close = prices[0]["close"], prices[-1]["close"]
            dashboard_rows.append(
                {
                    "name": item.get("name") or previous.get("name") or code,
                    "code": code,
                    "industry": item.get("category")
                    or previous.get("industry")
                    or "其他",
                    "index": item.get("trackingIndex")
                    or previous.get("index")
                    or "--",
                    "trackingIndexCode": index_code,
                    "size": item.get("size") or previous.get("size") or "--",
                    "marketCap": item.get("marketCap"),
                    "selectionRank": item.get("selectionRank"),
                    "pe": round(valuation[-1]["pe_ttm"], 2) if valuation else 0,
                    "percentile": percentile(valuation),
                    "return": round((last_close / first_close - 1) * 100, 2),
                    "actions": previous.get("actions", 0),
                    "days": len(prices),
                    "price": last_close,
                    "latestPriceDate": latest_price_date,
                    "latestPeDate": latest_pe_date,
                    "stale": stale,
                    "staleReason": stale_reason,
                    "dataAvailable": True,
                    "valuationAvailable": bool(valuation),
                }
            )
            results.append(
                {
                    "code": code,
                    "status": "已发布",
                    "klineDays": len(prices),
                    "latestDate": latest_price_date,
                    "pePoints": len(valuation),
                    "peStatus": "已发布" if valuation else "官方未公开",
                    "stale": stale,
                }
            )
        except Exception as exc:
            dashboard_rows.append(
                {
                    "name": item.get("name") or previous.get("name") or code,
                    "code": code,
                    "industry": item.get("category")
                    or previous.get("industry")
                    or "其他",
                    "index": item.get("trackingIndex")
                    or previous.get("index")
                    or "--",
                    "trackingIndexCode": index_code,
                    "size": item.get("size") or previous.get("size") or "--",
                    "return": None,
                    "actions": 0,
                    "days": 0,
                    "price": None,
                    "latestPriceDate": "",
                    "latestPeDate": "",
                    "stale": True,
                    "staleReason": str(exc),
                    "dataAvailable": False,
                    "valuationAvailable": False,
                }
            )
            results.append(
                {
                    "code": code,
                    "status": "失败",
                    "error": str(exc),
                    "stale": True,
                }
            )
            print(f"{code} | 发布失败 | {exc}", flush=True)

    dashboard_rows.sort(
        key=lambda row: (
            row.get("return") is None,
            -(row.get("return") or 0),
            row["code"],
        )
    )
    for rank, row in enumerate(dashboard_rows, 1):
        row["rank"] = rank
    failed = [row for row in results if row["status"] == "失败"]
    stale_count = sum(bool(row.get("stale")) for row in dashboard_rows)
    dashboard = {
        "updatedAt": published_at,
        "meta": {
            "latestTradingDate": max((row.get("latestPriceDate") or "" for row in dashboard_rows), default=""),
            "freshnessVerified": bool(expected and not context.get("marketCalendarError")),
            "session": context.get("session") or "manual",
            "sessionLabel": context.get("sessionLabel") or "数据更新",
            "selectionDate": context.get("selectionDate") or "",
            "cutoffDate": context.get("cutoffDate") or "",
            "expectedTradingDate": expected,
            "marketCalendarError": context.get("marketCalendarError") or "",
            "selectionError": context.get("selectionError") or "",
            "selectedCount": len(mappings),
            "publishedCount": len(dashboard_rows) - len(failed),
            "staleCount": stale_count,
            "failureCount": len(failed),
            "isPartial": bool(
                failed
                or stale_count
                or context.get("selectionError")
                or context.get("marketCalendarError")
            ),
        },
        "etfs": dashboard_rows,
    }
    write_json(DASHBOARD, dashboard)
    write_json(
        REPORT,
        {
            "publishedAt": published_at,
            "expectedTradingDate": expected,
            "results": results,
            "failedCount": len(failed),
            "staleCount": stale_count,
        },
    )

    UPLOAD.mkdir(parents=True, exist_ok=True)
    for filename in STATIC_FILES:
        shutil.copy2(PROJECT / filename, UPLOAD / filename)
    shutil.copytree(PROJECT / "data", UPLOAD / "data", dirs_exist_ok=True)

    with_pe = sum(row.get("pePoints", 0) > 0 for row in results)
    print(
        f"网页数据发布完成：{len(results) - len(failed)}/{len(mappings)} 只日K，"
        f"{with_pe} 只有官方PETTM，{len(failed)} 只失败，"
        f"{stale_count} 只数据过旧",
        flush=True,
    )
    if not any(row.get("dataAvailable") for row in dashboard_rows):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
