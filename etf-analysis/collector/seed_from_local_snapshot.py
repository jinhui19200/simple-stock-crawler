#!/usr/bin/env python3
"""Create the collector's initial snapshot from local, previously validated files.

This is a one-time bootstrap. Subsequent runs use update.py and do not read the
static webpage directory again.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from update import MAPPING, PE, PRICE, read_json, validate, write_json

SOURCE = Path(__file__).resolve().parents[1] / "data" / "etf"
REPORT = Path(__file__).resolve().parent / "output" / "seed_report.json"


def main() -> None:
    mappings = read_json(MAPPING, [])
    pe_by_index: dict[str, list[dict]] = {}
    completed, failed = [], []
    for item in mappings:
        code = str(item["code"])
        try:
            source = read_json(SOURCE / f"{code}.json", {})
            ohlc = source.get("ohlc") or []
            if not ohlc:
                raise ValueError("本地快照没有日K")
            prices = [{"date": str(point["date"])[:10], "open": float(point["open"]), "close": float(point["close"]), "high": float(point["high"]), "low": float(point["low"])} for point in ohlc]
            validate(prices)
            write_json(PRICE / f"{code}.json", {"code": code, "updatedAt": datetime.now().isoformat(timespec="seconds"), "source": "本地已校验快照（首次初始化）", "prices": prices})
            index_code = str(item.get("trackingIndexCode") or "")
            valuations = source.get("valuation") or []
            if index_code and valuations and len(valuations) > len(pe_by_index.get(index_code, [])):
                pe_by_index[index_code] = [{"date": str(point["date"])[:10], "peTTM": float(point["pe_ttm"])} for point in valuations if float(point.get("pe_ttm") or 0) > 0]
            completed.append(code)
        except Exception as exc:
            failed.append({"code": code, "error": str(exc)})
    for index_code, points in pe_by_index.items():
        write_json(PE / f"{index_code}.json", {"indexCode": index_code, "updatedAt": datetime.now().isoformat(timespec="seconds"), "source": "本地已校验官方PETTM快照（首次初始化）", "points": points})
    write_json(REPORT, {"initializedAt": datetime.now().isoformat(timespec="seconds"), "source": str(SOURCE), "completed": completed, "failed": failed, "indexPeCount": len(pe_by_index)})
    print(f"已初始化 {len(completed)} 只ETF日K、{len(pe_by_index)} 个跟踪指数PETTM；失败 {len(failed)} 只")


if __name__ == "__main__":
    main()
