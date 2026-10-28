#!/usr/bin/env python3
"""Isolate AkShare's request so its caller can enforce a wall clock timeout."""
import contextlib
import json
import sys


def main():
    code, begin, end = sys.argv[1:]
    # Keep progress output and library messages out of the JSON response.
    with contextlib.redirect_stdout(sys.stderr):
        import akshare as ak

        frame = ak.fund_etf_hist_em(
            symbol=code, period="daily", start_date=begin.replace("-", ""),
            end_date=end.replace("-", ""), adjust="qfq",
        )
        lines = [
            f"{str(row['日期'])[:10]},{row['开盘']},{row['收盘']},{row['最高']},{row['最低']}"
            for _, row in frame.iterrows()
        ]
    print(json.dumps({"data": {"klines": lines}}, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
