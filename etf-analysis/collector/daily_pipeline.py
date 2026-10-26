#!/usr/bin/env python3
"""Run the daily, noon, close, retry, or manual ETF data pipeline."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from universe_service import latest_market_trading_date, refresh_universe
from update import MAPPING, OUT, PE, PRICE, REPORT, read_json, run_update, write_json

ROOT = Path(__file__).resolve().parent
CONTEXT = OUT / "run_context.json"
CHINA = ZoneInfo("Asia/Shanghai")


def now_china() -> datetime:
    return datetime.now(CHINA)


def summarize_error(error: object) -> str:
    text = str(error or "").strip()
    if not text:
        return ""
    if "502 Server Error" in text or "Bad Gateway" in text:
        return "东方财富接口返回 502 Bad Gateway"
    if "Empty reply from server" in text or "RemoteDisconnected" in text:
        return "东方财富接口连接被远端关闭"
    if "NameResolutionError" in text or "nodename nor servname" in text:
        return "东方财富域名解析失败"
    return re.sub(r"https?://\S+", "[接口地址]", text)[:180]


def cutoff_for_session(session: str, current: date) -> date:
    return current - timedelta(days=1) if session == "noon" else current


def has_new_complete_trading_day(expected: str, previous_context: dict) -> bool:
    previous = str(previous_context.get("expectedTradingDate") or "")
    return bool(expected and (not previous or expected > previous))


def latest_cached_price_date(mappings: list[dict]) -> str:
    dates = []
    for item in mappings:
        payload = read_json(PRICE / f"{item['code']}.json", {})
        prices = payload.get("prices") if isinstance(payload.get("prices"), list) else []
        if prices:
            dates.append(str(prices[-1]["date"]))
    return max(dates, default="")


def resolve_expected_trading_date(session: str, mappings: list[dict], current: date) -> tuple[str, str]:
    cutoff = cutoff_for_session(session, current)
    try:
        return latest_market_trading_date(cutoff), ""
    except Exception as exc:
        fallback = latest_cached_price_date(mappings)
        return fallback, summarize_error(exc)


def retry_candidates(mappings: list[dict], expected: str) -> list[dict]:
    previous = read_json(REPORT, {})
    previous_by_code = {
        str(row.get("code")): row
        for row in previous.get("results", [])
        if row.get("code")
    }
    selected = []
    for item in mappings:
        row = previous_by_code.get(str(item["code"]))
        price = read_json(PRICE / f"{item['code']}.json", {})
        prices = price.get("prices") if isinstance(price.get("prices"), list) else []
        latest = str(prices[-1]["date"]) if prices else ""
        pe = read_json(PE / f"{item.get('trackingIndexCode', '')}.json", {})
        points = pe.get("points") if isinstance(pe.get("points"), list) else []
        latest_pe = str(points[-1]["date"]) if points else ""
        has_failure = bool(row and row.get("error"))
        if (
            not latest
            or latest < expected
            or (item.get("trackingPeAvailable") and (not latest_pe or latest_pe < expected))
            or has_failure
        ):
            selected.append(item)
    return selected


def run_pipeline(session: str, delay: float) -> dict:
    current = now_china().date()
    mappings = read_json(MAPPING, [])
    if not isinstance(mappings, list):
        mappings = []
    previous_context = read_json(CONTEXT, {})

    selection_error = ""
    universe_report = {}
    should_rescreen = (
        session == "manual"
        or not mappings
        or (session == "retry" and previous_context.get("selectionError"))
    )
    if should_rescreen:
        try:
            mappings, universe_report = refresh_universe(selection_date=current)
        except Exception as exc:
            selection_error = summarize_error(exc)
            print(f"ETF清单重新筛选失败，保留上一次名单：{exc}", file=sys.stderr, flush=True)
            if not mappings:
                raise

    expected, market_calendar_error = resolve_expected_trading_date(session, mappings, current)
    cutoff = cutoff_for_session(session, current)
    is_new_trading_day = has_new_complete_trading_day(expected, previous_context)
    if session == "daily" and not is_new_trading_day:
        context = {
            "session": session,
            "sessionLabel": "每日更新：无新的完整交易日",
            "startedAt": now_china().isoformat(timespec="seconds"),
            "finishedAt": now_china().isoformat(timespec="seconds"),
            "selectionDate": (
                mappings[0].get("selectionDate") if mappings else ""
            ) or current.isoformat(),
            "cutoffDate": cutoff.isoformat(),
            "expectedTradingDate": expected,
            "marketCalendarError": market_calendar_error,
            "selectionError": selection_error,
            "selectedCount": len(mappings),
            "attemptedCount": 0,
            "retryCount": 0,
            "failureCount": 0,
            "isPartial": bool(selection_error or market_calendar_error),
            "noNewTradingDay": True,
            "noUpdateReason": "无新的完整交易日，保留现有缓存和线上发布",
            "status": "no_change",
            "universeReport": {},
        }
        write_json(CONTEXT, context)
        write_json(
            REPORT,
            {
                "updatedAt": now_china().isoformat(timespec="seconds"),
                "label": session,
                "cutoffDate": cutoff.isoformat(),
                "results": [],
                "completed": 0,
                "total": 0,
                "noNewTradingDay": True,
            },
        )
        print(context["noUpdateReason"], flush=True)
        return context

    selected = mappings if session != "retry" else retry_candidates(mappings, expected)
    context = {
        "session": session,
        "sessionLabel": (
            "每日收盘更新"
            if session == "daily"
            else "午间更新（未纳入当天未收盘日K）"
            if session == "noon"
            else "收盘更新"
        ),
        "startedAt": now_china().isoformat(timespec="seconds"),
        "selectionDate": (
            mappings[0].get("selectionDate") if mappings else ""
        ) or current.isoformat(),
        "cutoffDate": cutoff.isoformat(),
        "expectedTradingDate": expected,
        "marketCalendarError": market_calendar_error,
        "selectionError": selection_error,
        "selectedCount": len(mappings),
        "attemptedCount": len(selected),
        "noNewTradingDay": False,
        "noUpdateReason": "",
        "universeReport": {
            key: universe_report.get(key)
            for key in (
                "spotCandidates",
                "selected",
                "uniqueTrackingIndexes",
                "profileRequests",
                "peRequests",
                "catalogSize",
            )
            if key in universe_report
        },
        "status": "running",
    }
    write_json(CONTEXT, context)

    if selected:
        report = run_update(
            selected,
            cutoff_date=cutoff,
            delay=delay,
            label=session,
        )
    else:
        report = {
            "updatedAt": now_china().isoformat(timespec="seconds"),
            "label": session,
            "cutoffDate": cutoff.isoformat(),
            "results": [],
        }
        write_json(REPORT, report)

    failures = [row for row in report.get("results", []) if row.get("error")]
    context.update(
        {
            "finishedAt": now_china().isoformat(timespec="seconds"),
            "failureCount": len(failures),
            "retryCount": len(selected),
            "isPartial": bool(failures or selection_error),
            "status": "partial" if failures or selection_error else "success",
        }
    )
    write_json(CONTEXT, context)
    return context


def check_freshness() -> int:
    mappings = read_json(MAPPING, [])
    context = read_json(CONTEXT, {})
    expected = str(context.get("expectedTradingDate") or "")
    if not mappings:
        print("ETF映射文件为空，无法检查新鲜度", file=sys.stderr)
        return 1
    if not expected:
        print("没有可用的预期交易日，无法检查新鲜度", file=sys.stderr)
        return 1
    missing = []
    for item in mappings:
        code = str(item["code"])
        price = read_json(PRICE / f"{code}.json", {})
        prices = price.get("prices") if isinstance(price.get("prices"), list) else []
        latest_price = str(prices[-1]["date"]) if prices else ""
        pe = read_json(PE / f"{item.get('trackingIndexCode', '')}.json", {})
        points = pe.get("points") if isinstance(pe.get("points"), list) else []
        latest_pe = str(points[-1]["date"]) if points else ""
        if not latest_price or latest_price < expected:
            missing.append(
                {
                    "code": code,
                    "kind": "price",
                    "latestDate": latest_price,
                    "expected": expected,
                }
            )
        if item.get("trackingPeAvailable") and (
            not latest_pe or latest_pe < expected
        ):
            missing.append(
                {
                    "code": code,
                    "kind": "petTM",
                    "latestDate": latest_pe,
                    "expected": expected,
                }
            )
    if context.get("selectionError"):
        missing.append(
            {"code": "universe", "kind": "selection", "expected": expected}
        )
    result = {
        "checkedAt": now_china().isoformat(timespec="seconds"),
        "expectedTradingDate": expected,
        "selectedCount": len(mappings),
        "missingCount": len(missing),
        "missing": missing,
    }
    write_json(OUT / "freshness_report.json", result)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    return 0 if not missing else 1


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--session",
        choices=("daily", "noon", "close", "retry", "manual"),
        required=True,
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=float(os.environ.get("ETF_REQUEST_DELAY", "5")),
    )
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if args.check_only:
        raise SystemExit(check_freshness())
    context = run_pipeline(args.session, args.delay)
    print(json.dumps(context, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
