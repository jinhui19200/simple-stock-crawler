from __future__ import annotations

import json
import os
import re
import socket
import threading
import time
from datetime import date, datetime, timedelta
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import akshare as ak
from akshare.utils import demjson
import pandas as pd
import requests


ROOT_DIR = Path(__file__).resolve().parent
PUBLIC_DIR = ROOT_DIR / "public"
HOST = os.getenv("STOCK_APP_HOST", "0.0.0.0")
PORT = int(os.getenv("PORT") or os.getenv("STOCK_APP_PORT", "8000"))
MARKET_REFRESH_SECONDS = 5
DETAIL_REFRESH_SECONDS = 5
REPORT_REFRESH_SECONDS = 12 * 60 * 60
HISTORY_REFRESH_SECONDS = 12 * 60 * 60
TARGET_STOCK_CODE = "000001"

for proxy_key in (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
):
    os.environ.pop(proxy_key, None)
os.environ["NO_PROXY"] = "*"
os.environ["no_proxy"] = "*"

RESOLVED_HOSTS: dict[str, list[str]] = {
    "vip.stock.finance.sina.com.cn": ["49.7.36.205", "106.63.15.52", "116.133.8.236"],
    "money.finance.sina.com.cn": ["49.7.36.205", "106.63.15.52", "116.133.8.236"],
    "quotes.sina.cn": ["49.7.36.205", "106.63.15.52", "116.133.8.236"],
    "web.ifzq.gtimg.cn": ["43.154.254.89", "43.154.254.185"],
    "push2.eastmoney.com": ["119.3.232.150", "120.79.191.232", "120.76.218.228"],
    "82.push2.eastmoney.com": ["47.112.165.11"],
    "push2his.eastmoney.com": ["117.184.38.143"],
    "datacenter-web.eastmoney.com": [
        "155.102.4.13",
        "155.102.4.10",
        "155.102.4.12",
        "155.102.4.11",
        "155.102.4.16",
        "155.102.4.15",
        "155.102.4.14",
    ],
    "datacenter.eastmoney.com": [
        "155.102.4.13",
        "155.102.4.10",
        "155.102.4.12",
        "155.102.4.11",
        "155.102.4.16",
        "155.102.4.15",
        "155.102.4.14",
    ],
}

_REAL_GETADDRINFO = socket.getaddrinfo


def install_host_resolver() -> None:
    def patched_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
        if host in RESOLVED_HOSTS:
            resolved = []
            for ip in RESOLVED_HOSTS[host]:
                try:
                    resolved.extend(
                        _REAL_GETADDRINFO(ip, port, family, type, proto, flags)
                    )
                except OSError:
                    continue
            if resolved:
                return resolved
        return _REAL_GETADDRINFO(host, port, family, type, proto, flags)

    socket.getaddrinfo = patched_getaddrinfo


install_host_resolver()

cache_lock = threading.Lock()
market_cache: dict[str, object] = {"expires_at": 0.0, "stocks": []}
report_cache: dict[str, dict[str, object]] = {}
history_cache: dict[str, dict[str, object]] = {}
latest_report_cache: dict[str, object] = {"expires_at": 0.0, "date": None}
financial_abstract_cache: dict[str, dict[str, object]] = {}


def iso_now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def get_lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            ip = sock.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        pass

    try:
        for _, _, _, _, sockaddr in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = sockaddr[0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        return None
    return None


def to_float(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_date_text(value: object) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, str):
        return value
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def to_market_symbol(code: str) -> str:
    normalized = str(code).zfill(6)
    if normalized.startswith(("6",)):
        return f"sh{normalized}"
    if normalized.startswith(("4", "8", "9")):
        return f"bj{normalized}"
    return f"sz{normalized}"


def quarter_candidates(years: int = 6) -> list[str]:
    today = date.today()
    result: list[str] = []
    for year in range(today.year, today.year - years - 1, -1):
        for month_day in ("1231", "0930", "0630", "0331"):
            result.append(f"{year}{month_day}")
    return result


def normalize_report_df(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return df
    frame = df.copy()
    frame["股票代码"] = frame["股票代码"].astype(str).str.zfill(6)
    return frame


def get_report_df(report_date: str) -> pd.DataFrame:
    now = time.time()
    with cache_lock:
        cached = report_cache.get(report_date)
        if cached and cached["expires_at"] > now:
            return cached["data"]  # type: ignore[return-value]

    frame = normalize_report_df(ak.stock_yjbb_em(date=report_date))
    with cache_lock:
        report_cache[report_date] = {
            "expires_at": now + REPORT_REFRESH_SECONDS,
            "data": frame,
        }
    return frame


def get_sina_spot_df() -> pd.DataFrame:
    count_response = requests.get(
        "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount?node=hs_a",
        timeout=20,
    )
    total_count = int(re.findall(r"\d+", count_response.text)[0])
    page_count = (total_count + 79) // 80
    payload = {
        "page": "1",
        "num": "80",
        "sort": "symbol",
        "asc": "1",
        "node": "hs_a",
        "symbol": "",
        "_s_r_a": "page",
    }
    frames: list[pd.DataFrame] = []
    for page in range(1, page_count + 1):
        payload["page"] = str(page)
        response = requests.get(
            "http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData",
            params=payload,
            timeout=20,
        )
        rows = demjson.decode(response.text)
        frames.append(pd.DataFrame(rows))
    frame = pd.concat(frames, ignore_index=True)
    frame = frame.astype(
        {
            "trade": "float",
            "pricechange": "float",
            "changepercent": "float",
            "buy": "float",
            "sell": "float",
            "settlement": "float",
            "open": "float",
            "high": "float",
            "low": "float",
            "volume": "float",
            "amount": "float",
            "per": "float",
            "pb": "float",
            "mktcap": "float",
            "nmc": "float",
            "turnoverratio": "float",
        }
    )
    frame["code"] = frame["code"].astype(str).str.zfill(6)
    return frame


def get_latest_report_date() -> str | None:
    now = time.time()
    with cache_lock:
        cached_date = latest_report_cache.get("date")
        if cached_date and latest_report_cache["expires_at"] > now:
            return cached_date  # type: ignore[return-value]

    for report_date in quarter_candidates():
        try:
            frame = get_report_df(report_date)
        except Exception:
            continue
        if not frame.empty:
            with cache_lock:
                latest_report_cache["date"] = report_date
                latest_report_cache["expires_at"] = now + REPORT_REFRESH_SECONDS
            return report_date
    return None


def build_market_rows() -> list[dict[str, object]]:
    spot_df = get_sina_spot_df()

    latest_report_date = get_latest_report_date()
    gross_margin_map: dict[str, float | None] = {}
    report_date_map: dict[str, str | None] = {}
    if latest_report_date:
        report_df = get_report_df(latest_report_date)
        gross_margin_map = dict(
            zip(report_df["股票代码"], report_df["销售毛利率"].map(to_float))
        )
        report_date_map = dict(
            zip(report_df["股票代码"], report_df["最新公告日期"].map(to_date_text))
        )

    rows: list[dict[str, object]] = []
    updated_at = iso_now()
    for _, row in spot_df.iterrows():
        code = row["code"]
        if code != TARGET_STOCK_CODE:
            continue
        latest_price = to_float(row["trade"])
        market_value = to_float(row["mktcap"])
        pe = to_float(row["per"])
        rows.append(
            {
                "code": code,
                "name": row["name"],
                "latestPrice": latest_price,
                "marketValue": market_value,
                "grossMargin": gross_margin_map.get(code),
                "grossMarginUpdatedAt": report_date_map.get(code),
                "pe": pe,
                "changePercent": to_float(row["changepercent"]),
                "updatedAt": updated_at,
            }
        )
    return sorted(rows, key=lambda item: item["code"])


def get_market_rows() -> list[dict[str, object]]:
    now = time.time()
    with cache_lock:
        if market_cache["expires_at"] > now:
            return market_cache["stocks"]  # type: ignore[return-value]

    rows = build_market_rows()
    with cache_lock:
        market_cache["stocks"] = rows
        market_cache["expires_at"] = now + MARKET_REFRESH_SECONDS
    return rows


def get_stock_row(code: str, allow_stale: bool = True) -> dict[str, object] | None:
    if code != TARGET_STOCK_CODE:
        return None
    if allow_stale:
        with cache_lock:
            cached_rows = list(market_cache.get("stocks") or [])
        for row in cached_rows:
            if row["code"] == code:
                return row
    for row in get_market_rows():
        if row["code"] == code:
            return row
    return None


def get_history_df(code: str) -> pd.DataFrame:
    now = time.time()
    with cache_lock:
        cached = history_cache.get(code)
        if cached and cached["expires_at"] > now:
            return cached["data"]  # type: ignore[return-value]

    start_date = (date.today() - timedelta(days=365 * 5 + 7)).strftime("%Y%m%d")
    end_date = date.today().strftime("%Y%m%d")
    symbol = f"sz{code}" if code.startswith(("0", "2", "3")) else f"sh{code}"
    frame = ak.stock_zh_a_hist_tx(
        symbol=symbol,
        start_date=start_date,
        end_date=end_date,
        adjust="qfq",
    )
    if not frame.empty:
        frame = frame.rename(
            columns={
                "date": "日期",
                "open": "开盘",
                "close": "收盘",
                "high": "最高",
                "low": "最低",
                "amount": "成交额",
            }
        )
    with cache_lock:
        history_cache[code] = {
            "expires_at": now + HISTORY_REFRESH_SECONDS,
            "data": frame,
        }
    return frame


def get_gross_margin_history(code: str) -> list[dict[str, object]]:
    now = time.time()
    cache_key = f"gross_margin:{code}"
    with cache_lock:
        cached = financial_abstract_cache.get(cache_key)
        if cached and cached["expires_at"] > now:
            return cached["data"]  # type: ignore[return-value]

    response = requests.get(
        "https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022",
        params={
            "paperCode": to_market_symbol(code),
            "source": "gjzb",
            "type": "0",
            "page": "1",
            "num": "1000",
        },
        timeout=20,
        verify=False,
    )
    data_json = response.json()
    report_list = data_json.get("result", {}).get("data", {}).get("report_list", {})
    points: list[dict[str, object]] = []
    for report_date in sorted(report_list.keys()):
        entries = report_list.get(report_date, {}).get("data", [])
        matched = next(
            (
                entry
                for entry in entries
                if entry.get("item_field") == "SGPMARGIN"
                or entry.get("item_title") == "毛利率"
            ),
            None,
        )
        gross_margin = to_float(matched.get("item_value") if matched else None)
        if gross_margin is None:
            continue
        points.append(
            {
                "date": f"{report_date[:4]}-{report_date[4:6]}-{report_date[6:]}",
                "value": gross_margin,
            }
        )

    with cache_lock:
        financial_abstract_cache[cache_key] = {
            "expires_at": now + REPORT_REFRESH_SECONDS,
            "data": points,
        }
    return points


def get_stock_detail(code: str) -> dict[str, object] | None:
    if code != TARGET_STOCK_CODE:
        return None
    row = get_stock_row(code, allow_stale=True)
    if not row:
        return None

    history_df = get_history_df(code)
    price_history = [
        {"date": item["日期"].isoformat(), "value": to_float(item["收盘"])}
        for _, item in history_df.iterrows()
        if to_float(item["收盘"]) is not None
    ]
    latest_price = to_float(row["latestPrice"])
    market_value = to_float(row["marketValue"])
    pe = to_float(row["pe"])
    shares = None
    if latest_price and market_value and latest_price > 0:
        shares = market_value / latest_price

    gross_margin_history = get_gross_margin_history(code)
    current_gross_margin = row.get("grossMargin")
    if current_gross_margin is None and gross_margin_history:
        current_gross_margin = gross_margin_history[-1]["value"]

    return {
        "code": code,
        "name": row["name"],
        "latestPrice": latest_price,
        "marketValue": market_value,
        "grossMargin": current_gross_margin,
        "grossMarginUpdatedAt": row.get("grossMarginUpdatedAt"),
        "pe": pe,
        "shareCountEstimate": shares,
        "updatedAt": row["updatedAt"],
        "source": "新浪 + 腾讯 + 东方财富财报",
        "refreshIntervalSeconds": DETAIL_REFRESH_SECONDS,
        "priceHistory": price_history,
        "grossMarginHistory": gross_margin_history,
    }


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(PUBLIC_DIR), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/healthz":
            return self.handle_health()
        if parsed.path == "/api/market":
            return self.handle_market()
        if parsed.path == "/api/stock":
            return self.handle_stock(parsed)

        if parsed.path == "/":
            self.path = "/index.html"
        else:
            self.path = parsed.path
        return super().do_GET()

    def handle_market(self):
        try:
            payload = {
                "updatedAt": iso_now(),
                "refreshIntervalSeconds": MARKET_REFRESH_SECONDS,
                "stocks": get_market_rows(),
            }
            self.send_json(200, payload)
        except Exception as exc:
            self.send_json(500, {"error": "market_fetch_failed", "detail": str(exc)})

    def handle_health(self):
        self.send_json(
            200,
            {
                "status": "ok",
                "stock": TARGET_STOCK_CODE,
                "updatedAt": iso_now(),
            },
        )

    def handle_stock(self, parsed):
        code = parse_qs(parsed.query).get("code", [""])[0].strip()
        if not code:
            return self.send_json(400, {"error": "missing_code"})
        try:
            payload = get_stock_detail(code)
            if not payload:
                return self.send_json(404, {"error": "stock_not_found"})
            self.send_json(200, payload)
        except Exception as exc:
            self.send_json(500, {"error": "stock_fetch_failed", "detail": str(exc)})

    def send_json(self, status_code: int, payload: dict[str, object]):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main():
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    print(f"Stock app running on {HOST}:{PORT}")
    print(f"Local access: http://127.0.0.1:{PORT}")
    lan_ip = get_lan_ip()
    if lan_ip:
        print(f"LAN access:   http://{lan_ip}:{PORT}")
    else:
        print("LAN access:   请使用当前电脑的局域网 IP 地址访问")
    server.serve_forever()


if __name__ == "__main__":
    main()
