#!/usr/bin/env python3
"""Incrementally update ETF qfq OHLC and official tracking-index PETTM."""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
import urllib.parse
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parent
MAPPING = ROOT / "etf_mapping.json"
OUT = ROOT / "output"
PRICE = OUT / "etf_price"
PE = OUT / "index_pe"
RAW_PRICE = OUT / "raw" / "etf_price"
RAW_PE = OUT / "raw" / "index_pe"
REPORT = OUT / "update_report.json"
EASTMONEY = "https://push2his.eastmoney.com/api/qt/stock/kline/get"
# The primary and backup endpoints are both Eastmoney data services.  The
# backup uses the non-history gateway, which is useful when the history host
# is temporarily returning 502/empty responses from a CI runner.
EASTMONEY_BACKUP = "https://push2.eastmoney.com/api/qt/stock/kline/get"
CSI = "https://www.csindex.com.cn/csindex-home/perf/indexCsiDsPe"
HTTP_PROXY = os.environ.get("ETF_HTTP_PROXY", "").strip()
HTTP_CONNECT_TIMEOUT = os.environ.get("ETF_HTTP_CONNECT_TIMEOUT", "5")
HTTP_MAX_TIME = os.environ.get("ETF_HTTP_MAX_TIME", "20")
PRICE_START = date(2020, 1, 1)
PE_START = date(2016, 1, 1)
DEFAULT_BATCH_SIZE = 15
DEFAULT_BATCH_PAUSE = 20.0


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


def after(day: str) -> str:
    return (date.fromisoformat(day[:10]) + timedelta(days=1)).isoformat()


def read_cache(path: Path, key: str) -> dict:
    """Never treat an unreadable existing cache as permission to fetch all history."""
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ValueError(f"已有缓存不可读，保留原文件并停止该项：{path.name}") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get(key), list) or not payload[key]:
        raise ValueError(f"已有缓存格式无效，保留原文件并停止该项：{path.name}")
    return payload


def request_json(
    url: str,
    headers: dict[str, str],
    *,
    proxy: str | None = None,
) -> dict:
    """Perform one request with the required 3/6/12 second retry backoff."""
    error = ""
    for attempt, pause in enumerate((0, 3, 6, 12)):
        if pause:
            time.sleep(pause)
        try:
            command = [
                "curl",
                "--silent",
                "--show-error",
                "--fail-with-body",
                "--location",
                "--connect-timeout",
                HTTP_CONNECT_TIMEOUT,
                "--max-time",
                HTTP_MAX_TIME,
            ]
            effective_proxy = HTTP_PROXY if proxy is None else proxy
            if effective_proxy:
                command.extend(("--proxy", effective_proxy))
            for key, value in headers.items():
                command.extend(("--header", f"{key}: {value}"))
            command.append(url)
            result = subprocess.run(
                command, text=True, capture_output=True, check=False,
                timeout=float(HTTP_MAX_TIME) + 5,
            )
            if result.returncode == 0:
                return json.loads(result.stdout)
            error = result.stderr.strip() or f"curl退出码{result.returncode}"
        except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
            error = str(exc)
        if attempt == 3:
            break
    raise RuntimeError(error)


def validate(rows: list[dict]) -> None:
    dates = [str(row.get("date") or "") for row in rows]
    if not rows or dates != sorted(dates) or len(dates) != len(set(dates)):
        raise ValueError("日期为空、无序或重复")
    for row in rows:
        date.fromisoformat(row["date"])
        low, opening, closing, high = (
            float(row[key]) for key in ("low", "open", "close", "high")
        )
        if not all(math.isfinite(value) for value in (low, opening, closing, high)) or min(low, opening, closing, high) <= 0 or not (
            low <= min(opening, closing) <= max(opening, closing) <= high
        ):
            raise ValueError(f"OHLC无效：{row['date']}")


def kline_rows(payload: dict) -> list[dict]:
    rows = {}
    for line in (payload.get("data") or {}).get("klines") or []:
        values = str(line).split(",")
        try:
            rows[values[0]] = {
                "date": values[0],
                "open": float(values[1]),
                "close": float(values[2]),
                "high": float(values[3]),
                "low": float(values[4]),
            }
        except (IndexError, ValueError):
            continue
    result = [rows[key] for key in sorted(rows)]
    if result:
        validate(result)
    return result


def eastmoney_kline_request(
    query: str,
    headers: dict[str, str],
) -> tuple[dict, str]:
    """Read K-lines from Eastmoney, then its alternate gateway.

    AkShare is deliberately not used here: it is a parser/client for the
    same Eastmoney service and is handled separately by ``update_price``.
    Returning the endpoint label lets the cache record which official
    Eastmoney gateway actually supplied the data.
    """
    errors: list[str] = []
    endpoints = (
        (EASTMONEY, "东方财富主接口"),
        (EASTMONEY_BACKUP, "东方财富备用接口"),
    )
    for endpoint, label in endpoints:
        try:
            payload = request_json(endpoint + "?" + query, headers)
            if not kline_rows(payload):
                raise ValueError("未返回有效日K记录")
            return payload, label
        except Exception as exc:
            errors.append(f"{label}：{exc}")
    raise RuntimeError("；".join(errors))


def pe_rows(payload: dict) -> list[dict]:
    rows = {}
    for item in payload.get("data") or []:
        try:
            day, value = str(item["tradeDate"]), float(item["peg"])
            if len(day) == 8 and value > 0:
                rows[day] = {
                    "date": f"{day[:4]}-{day[4:6]}-{day[6:]}",
                    "peTTM": value,
                }
        except (KeyError, TypeError, ValueError):
            continue
    return [rows[key] for key in sorted(rows)]


def merged(old: list[dict], new: list[dict]) -> list[dict]:
    values = {str(row["date"]): row for row in old}
    values.update({str(row["date"]): row for row in new})
    return [values[key] for key in sorted(values)]


def market_id(code: str) -> str:
    return "1" if code.startswith(("5", "6", "9")) else "0"


def update_price(
    code: str,
    cutoff_date: date,
    price_start: date = PRICE_START,
) -> tuple[str, str]:
    saved = read_cache(PRICE / f"{code}.json", "prices")
    old = saved.get("prices") if isinstance(saved.get("prices"), list) else []
    if old:
        validate(old)
    latest = str(old[-1]["date"]) if old else ""
    begin = after(latest) if latest else price_start.isoformat()
    if begin > cutoff_date.isoformat():
        return "无需更新", latest
    print(f"{code} | 日K增量区间：{begin} 至 {cutoff_date.isoformat()}", flush=True)

    market = market_id(code)
    query = urllib.parse.urlencode(
        {
            "secid": f"{market}.{code}",
            "klt": "101",
            "fqt": "1",
            "ut": "7eea3edcaed734bea9cbfc24409ed989",
            "fields1": "f1,f2,f3,f4,f5,f6",
            "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116",
            "beg": begin.replace("-", ""),
            "end": cutoff_date.strftime("%Y%m%d"),
        }
    )
    source = "东方财富前复权日K（fqt=1）"
    try:
        raw, source_label = eastmoney_kline_request(
            query,
            {
                "User-Agent": "Mozilla/5.0",
                "Referer": (
                    f"https://quote.eastmoney.com/"
                    f"{'sh' if market == '1' else 'sz'}{code}.html"
                ),
            },
        )
        incoming = kline_rows(raw)
        source = f"{source_label}前复权日K（fqt=1）"
    except Exception as primary_error:
        try:
            import akshare as ak

            frame = ak.fund_etf_hist_em(
                symbol=code,
                period="daily",
                start_date=begin.replace("-", ""),
                end_date=cutoff_date.strftime("%Y%m%d"),
                adjust="qfq",
            )
            raw = {
                "data": {
                    "klines": [
                        f"{str(row['日期'])[:10]},{row['开盘']},{row['收盘']},"
                        f"{row['最高']},{row['最低']}"
                        for _, row in frame.iterrows()
                    ]
                }
            }
            incoming, source = kline_rows(raw), "AkShare东方财富"
        except Exception as fallback_error:
            raise RuntimeError(
                f"东方财富：{primary_error}；AkShare：{fallback_error}"
            ) from fallback_error

    incoming = [
        row for row in incoming
        if begin <= row["date"] <= cutoff_date.isoformat()
    ]
    if not incoming:
        return "无新增交易日", latest
    fetched_at = datetime.now().astimezone().isoformat(timespec="seconds")
    write_json(
        RAW_PRICE / code / f"{datetime.now().strftime('%Y%m%dT%H%M%S')}.json",
        {
            "code": code,
            "requestedStart": begin,
            "requestedEnd": cutoff_date.isoformat(),
            "fetchedAt": fetched_at,
            "source": source,
            "payload": raw,
        },
    )
    complete = merged(old, incoming)
    validate(complete)
    write_json(
        PRICE / f"{code}.json",
        {
            "code": code,
            "updatedAt": fetched_at,
            "source": source,
            "requestedStart": begin,
            "requestedEnd": cutoff_date.isoformat(),
            "prices": complete,
        },
    )
    return f"新增{len(incoming)}", str(complete[-1]["date"])


def update_pe(
    index_code: str,
    official_available: bool,
    cutoff_date: date,
    pe_start: date = PE_START,
) -> tuple[str, str]:
    if not official_available:
        saved = read_json(PE / f"{index_code}.json", {})
        points = saved.get("points") if isinstance(saved.get("points"), list) else []
        return "官方历史PETTM未公开", str(points[-1]["date"]) if points else ""

    saved = read_cache(PE / f"{index_code}.json", "points")
    old = saved.get("points") if isinstance(saved.get("points"), list) else []
    if old:
        days = [row["date"] for row in old]
        if days != sorted(set(days)):
            raise ValueError(f"已有PETTM缓存日期无序或重复：{index_code}")
        for row in old:
            date.fromisoformat(row["date"])
            if not math.isfinite(float(row["peTTM"])) or float(row["peTTM"]) <= 0:
                raise ValueError(f"已有PETTM数值无效：{index_code}")
    latest = str(old[-1]["date"]) if old else ""
    begin = after(latest) if latest else pe_start.isoformat()
    if begin > cutoff_date.isoformat():
        return "无需更新", latest
    query = urllib.parse.urlencode(
        {
            "indexCode": index_code,
            "startDate": begin.replace("-", ""),
            "endDate": cutoff_date.strftime("%Y%m%d"),
        }
    )
    raw = request_json(
        CSI + "?" + query,
        {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://www.csindex.com.cn/",
        },
    )
    incoming = [
        row for row in pe_rows(raw)
        if begin <= row["date"] <= cutoff_date.isoformat()
    ]
    if not incoming:
        return "官方无新增", latest
    fetched_at = datetime.now().astimezone().isoformat(timespec="seconds")
    write_json(
        RAW_PE / index_code / f"{datetime.now().strftime('%Y%m%dT%H%M%S')}.json",
        {
            "indexCode": index_code,
            "requestedStart": begin,
            "requestedEnd": cutoff_date.isoformat(),
            "fetchedAt": fetched_at,
            "source": "中证指数官网历史估值接口",
            "payload": raw,
        },
    )
    complete = merged(old, incoming)
    write_json(
        PE / f"{index_code}.json",
        {
            "indexCode": index_code,
            "updatedAt": fetched_at,
            "source": "中证指数官网历史估值接口",
            "requestedStart": begin,
            "requestedEnd": cutoff_date.isoformat(),
            "points": complete,
        },
    )
    return f"新增{len(incoming)}", str(complete[-1]["date"])


def run_update(
    selected: Iterable[dict],
    *,
    cutoff_date: date,
    delay: float = 5,
    label: str = "manual",
    batch_size: int = DEFAULT_BATCH_SIZE,
    batch_pause: float = DEFAULT_BATCH_PAUSE,
) -> dict:
    selected = list(selected)
    if batch_size <= 0:
        raise ValueError("batch_size 必须大于 0")
    batches = [
        selected[start : start + batch_size]
        for start in range(0, len(selected), batch_size)
    ]
    pe_status: dict[str, tuple[str, str]] = {}
    results = []
    total_batches = len(batches)
    for batch_number, batch in enumerate(batches, 1):
        print(
            f"开始第 {batch_number}/{total_batches} 批更新："
            f"{len(batch)} 只 ETF（批大小 {batch_size}）",
            flush=True,
        )
        batch_start = (batch_number - 1) * batch_size
        for offset, item in enumerate(batch):
            position = batch_start + offset + 1
            code = str(item["code"])
            index_code = str(item.get("trackingIndexCode") or "")
            errors = []
            print(f"[{position}/{len(selected)}] 开始处理 {code}", flush=True)
            try:
                price_status, price_latest = update_price(code, cutoff_date)
            except Exception as exc:
                prices = read_json(PRICE / f"{code}.json", {}).get("prices") or []
                price_status, price_latest = "失败", prices[-1]["date"] if prices else ""
                errors.append(f"日K：{exc}")
            try:
                if not index_code:
                    raise ValueError("缺少跟踪指数代码")
                if index_code not in pe_status:
                    pe_status[index_code] = update_pe(
                        index_code,
                        bool(item.get("trackingPeAvailable")),
                        cutoff_date,
                    )
                pe_result, pe_latest = pe_status[index_code]
            except Exception as exc:
                pe_result, pe_latest = "失败", ""
                errors.append(f"PETTM：{exc}")

            row = {
                "code": code,
                "name": item.get("name") or code,
                "trackingIndexCode": index_code,
                "priceStatus": price_status,
                "peStatus": pe_result,
                "latestDate": price_latest,
                "latestPeDate": pe_latest,
                "error": "；".join(errors),
                "batch": batch_number,
                "batchCount": total_batches,
            }
            results.append(row)
            print(
                f"[{position}/{len(selected)} | 批 {batch_number}/{total_batches}] "
                f"{code} | 日K：{price_status} | PETTM：{pe_result} | "
                f"最新：{price_latest or '-'} | {row['error'] or '-'}",
                flush=True,
            )
            write_json(
                REPORT,
                {
                    "updatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
                    "label": label,
                    "cutoffDate": cutoff_date.isoformat(),
                    "results": results,
                    "completed": position,
                    "total": len(selected),
                    "batchSize": batch_size,
                    "batchCount": total_batches,
                    "completedBatches": batch_number - 1
                    + (1 if offset == len(batch) - 1 else 0),
                },
            )
            if position < len(selected):
                time.sleep(max(0, delay))
        if os.environ.get("ETF_CHECKPOINT_BATCHES") == "true":
            subprocess.run(
                [sys.executable, str(ROOT / "cloud_checkpoint.py")], check=True,
            )
        if batch_number < total_batches and batch_pause > 0:
            print(
                f"第 {batch_number} 批完成，等待 {batch_pause:g} 秒后继续下一批",
                flush=True,
            )
            time.sleep(batch_pause)

    report = {
        "updatedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "label": label,
        "cutoffDate": cutoff_date.isoformat(),
        "results": results,
        "completed": len(results),
        "total": len(selected),
        "batchSize": batch_size,
        "batchCount": total_batches,
        "completedBatches": total_batches,
    }
    write_json(REPORT, report)
    return report


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--code", action="append", help="仅更新指定ETF代码，可重复使用")
    parser.add_argument("--delay", type=float, default=5, help="每只ETF之间的等待秒数")
    parser.add_argument(
        "--batch-size",
        type=int,
        default=int(os.environ.get("ETF_BATCH_SIZE", str(DEFAULT_BATCH_SIZE))),
        help="每批处理的ETF数量，默认15",
    )
    parser.add_argument(
        "--batch-pause",
        type=float,
        default=float(os.environ.get("ETF_BATCH_PAUSE", str(DEFAULT_BATCH_PAUSE))),
        help="批次之间的等待秒数，默认20",
    )
    parser.add_argument(
        "--cutoff-date",
        default=date.today().isoformat(),
        help="允许写入的最新日期，格式 YYYY-MM-DD",
    )
    args = parser.parse_args()
    mappings = read_json(MAPPING, [])
    selected = [
        item
        for item in mappings
        if not args.code or str(item["code"]) in args.code
    ]
    if not selected:
        raise SystemExit("没有匹配的ETF代码或映射文件为空")
    run_update(
        selected,
        cutoff_date=date.fromisoformat(args.cutoff_date),
        delay=args.delay,
        batch_size=args.batch_size,
        batch_pause=args.batch_pause,
    )


if __name__ == "__main__":
    main()
