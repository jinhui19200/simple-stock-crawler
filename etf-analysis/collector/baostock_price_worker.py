#!/usr/bin/env python3
"""Fetch one ETF's forward-adjusted daily candles through BaoStock."""
from __future__ import annotations

import contextlib
import json
import sys


def market_code(code: str) -> str:
    code = str(code).zfill(6)
    return f"sh.{code}" if code.startswith(("5", "6", "9")) else f"sz.{code}"


def main() -> None:
    import baostock as bs

    code, begin, end = sys.argv[1:]
    with contextlib.redirect_stdout(sys.stderr):
        login = bs.login()
        if getattr(login, "error_code", "1") != "0":
            raise RuntimeError(f"BaoStock登录失败：{getattr(login, 'error_msg', '')}")
        try:
            result = bs.query_history_k_data_plus(
                market_code(code),
                "date,open,high,low,close",
                start_date=begin,
                end_date=end,
                frequency="d",
                adjustflag="2",
            )
            if getattr(result, "error_code", "1") != "0":
                raise RuntimeError(f"BaoStock查询失败：{getattr(result, 'error_msg', '')}")
            rows = []
            while result.next():
                values = result.get_row_data()
                if len(values) >= 5:
                    date_value, opening, high, low, closing = values[:5]
                    rows.append(",".join((date_value, opening, closing, high, low)))
        finally:
            bs.logout()
    print(json.dumps({"data": {"klines": rows}}, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
