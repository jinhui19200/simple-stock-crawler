#!/usr/bin/env python3
"""Read-only Eastmoney probe shared by the Mac and GitHub runner."""
import argparse
import json
import math
import subprocess
import time
import urllib.parse
from datetime import date, datetime, timezone
from pathlib import Path

ENDPOINTS = (
    ("primary", "https://push2his.eastmoney.com/api/qt/stock/kline/get"),
    ("backup", "https://push2.eastmoney.com/api/qt/stock/kline/get"),
)


def probe(begin, end, label, proxy=""):
    date.fromisoformat(begin)
    date.fromisoformat(end)
    query = urllib.parse.urlencode({
        "secid": "1.512760", "klt": "101", "fqt": "1",
        "ut": "7eea3edcaed734bea9cbfc24409ed989",
        "fields1": "f1,f2,f3,f4,f5,f6",
        "fields2": "f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f116",
        "beg": begin.replace("-", ""), "end": end.replace("-", ""),
    })
    report = {"label": label, "code": "512760", "begin": begin, "end": end,
              "testedAt": datetime.now(timezone.utc).isoformat(), "results": []}
    for index, (name, endpoint) in enumerate(ENDPOINTS):
        if index:
            time.sleep(5)
        result = {"endpoint": name, "ok": False, "attempts": []}
        for pause in (0, 3, 6, 12):
            if pause:
                time.sleep(pause)
            command = ["curl", "--silent", "--show-error", "--fail-with-body",
                       "--location", "--connect-timeout", "5", "--max-time", "20",
                       "--header", "User-Agent: Mozilla/5.0",
                       "--header", "Referer: https://quote.eastmoney.com/sh512760.html"]
            command += ["--proxy", proxy] if proxy else ["--noproxy", "*"]
            started = time.monotonic()
            try:
                response = subprocess.run(command + [endpoint + "?" + query],
                                          capture_output=True, text=True, timeout=25)
                if response.returncode:
                    raise ValueError(response.stderr.strip() or f"curl exit {response.returncode}")
                payload = json.loads(response.stdout)
                dates = []
                for line in (payload.get("data") or {}).get("klines") or []:
                    fields = line.split(",")
                    day = date.fromisoformat(fields[0]).isoformat()
                    opening, closing, high, low = map(float, fields[1:5])
                    if not all(math.isfinite(x) and x > 0 for x in (opening, closing, high, low)):
                        raise ValueError("OHLC contains nonpositive or nonfinite value")
                    if not low <= min(opening, closing) <= max(opening, closing) <= high:
                        raise ValueError("OHLC price relationship invalid")
                    if begin <= day <= end:
                        dates.append(day)
                if not dates:
                    raise ValueError("HTTP succeeded but no valid new daily candles returned")
                if dates != sorted(set(dates)):
                    raise ValueError("Daily candle dates are duplicated or unordered")
                result.update(ok=True, count=len(dates), latestDate=dates[-1],
                              reachesCutoff=dates[-1] == end)
                result["attempts"].append({"seconds": round(time.monotonic() - started, 2), "ok": True})
                break
            except (OSError, ValueError, TypeError, IndexError, subprocess.TimeoutExpired) as exc:
                result["attempts"].append({"seconds": round(time.monotonic() - started, 2),
                                           "error": str(exc)[:500]})
        report["results"].append(result)
        print(json.dumps({"label": label, **result}, ensure_ascii=False), flush=True)
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--begin", required=True)
    parser.add_argument("--end", required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--proxy", default="")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = probe(args.begin, args.end, args.label, args.proxy)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
