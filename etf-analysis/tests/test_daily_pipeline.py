from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "collector"))

import publish_to_dashboard as publisher_helpers  # noqa: E402
import update as updater  # noqa: E402
from daily_pipeline import (  # noqa: E402
    cutoff_for_session,
    has_new_complete_trading_day,
    summarize_error,
)
from universe_service import (  # noqa: E402
    deduplicate_candidates,
    eligible_profile,
    is_broad,
    is_stock_etf,
    select_universe,
)
from update import (
    EASTMONEY,
    EASTMONEY_BACKUP,
    eastmoney_kline_request,
    kline_rows,
    merged,
    run_update,
    validate,
)  # noqa: E402


class UniverseRulesTest(unittest.TestCase):
    def test_stock_etf_filter(self) -> None:
        self.assertTrue(is_stock_etf("指数型-股票"))
        self.assertFalse(is_stock_etf("QDII-指数"))
        self.assertFalse(is_stock_etf("债券型"))
        self.assertFalse(is_stock_etf("商品型"))

    def test_broad_index_filter(self) -> None:
        self.assertTrue(is_broad("沪深300ETF", "沪深300指数"))
        self.assertTrue(is_broad("中证A500ETF", "中证A500指数"))
        self.assertTrue(is_broad("红利低波ETF", "红利低波指数"))
        self.assertFalse(is_broad("芯片ETF", "中证全指半导体产品与设备指数"))
        self.assertFalse(is_broad("科创芯片ETF", "上证科创板芯片指数"))

    def test_eligibility_requires_cap_stock_type_and_index(self) -> None:
        valid = {
            "fundType": "指数型-股票",
            "trackingIndexCode": "H30184",
            "trackingIndex": "中证全指半导体产品与设备指数",
        }
        self.assertEqual(
            eligible_profile("512760", "芯片ETF", 2_000_000_000, valid),
            (True, ""),
        )
        self.assertFalse(
            eligible_profile("512760", "芯片ETF", 999_999_999, valid)[0]
        )
        self.assertFalse(
            eligible_profile(
                "512760",
                "芯片ETF",
                2_000_000_000,
                {**valid, "fundType": "QDII-股票"},
            )[0]
        )

    def test_deduplicate_keeps_largest_etf_for_each_index(self) -> None:
        candidates = [
            {"code": "512001", "marketCap": 20, "trackingIndexCode": "A"},
            {"code": "512002", "marketCap": 10, "trackingIndexCode": "A"},
            {"code": "512003", "marketCap": 12, "trackingIndexCode": "B"},
        ]
        result = deduplicate_candidates(candidates)
        self.assertEqual([row["code"] for row in result], ["512001", "512003"])

    @patch("universe_service.time.sleep")
    @patch("universe_service._probe_pe")
    @patch("universe_service.fetch_profile")
    def test_selector_skips_unavailable_and_fills_from_next(
        self,
        fetch_profile,
        probe_pe,
        _sleep,
    ) -> None:
        profiles = {
            "510001": {
                "fundType": "指数型-股票",
                "trackingIndexCode": "A",
                "trackingIndex": "中证芯片产业指数",
                "trackingIndexMaker": "中证指数有限公司",
            },
            "510002": {
                "fundType": "指数型-股票",
                "trackingIndexCode": "B",
                "trackingIndex": "中证医药卫生指数",
                "trackingIndexMaker": "中证指数有限公司",
            },
            "510003": {
                "fundType": "指数型-股票",
                "trackingIndexCode": "C",
                "trackingIndex": "中证煤炭指数",
                "trackingIndexMaker": "中证指数有限公司",
            },
        }
        fetch_profile.side_effect = lambda code: profiles[code]
        probe_pe.side_effect = [
            (False, "", "官方历史PETTM不可用"),
            (True, "2026-10-23", ""),
            (True, "2026-10-23", ""),
        ]
        spot = [
            {"code": "510001", "name": "芯片ETF", "marketCap": 30_000_000_000},
            {"code": "510002", "name": "医药ETF", "marketCap": 20_000_000_000},
            {"code": "510003", "name": "煤炭ETF", "marketCap": 10_000_000_000},
        ]
        selected, details = select_universe(spot, {}, limit=2)
        self.assertEqual([row["code"] for row in selected], ["510002", "510003"])
        self.assertIn("官方历史PETTM不可用", details["rejected"]["510001"])


class PriceValidationTest(unittest.TestCase):
    @patch("update.request_json")
    def test_eastmoney_backup_gateway_is_used_after_primary_failure(
        self, request_json
    ) -> None:
        payload = {
            "data": {
                "klines": ["2026-10-24,1.0,1.1,1.2,0.9"],
            }
        }
        request_json.side_effect = [RuntimeError("502 Bad Gateway"), payload]
        result, source = eastmoney_kline_request(
            "secid=1.512760&klt=101",
            {"User-Agent": "test"},
        )
        self.assertEqual(result, payload)
        self.assertEqual(source, "东方财富备用接口")
        self.assertEqual(request_json.call_count, 2)
        self.assertTrue(request_json.call_args_list[0].args[0].startswith(EASTMONEY))
        self.assertTrue(
            request_json.call_args_list[1].args[0].startswith(EASTMONEY_BACKUP)
        )

    def test_provider_error_is_summarized_without_request_url(self) -> None:
        message = summarize_error(
            "502 Server Error for url: https://push2delay.eastmoney.com/api/qt/clist/get?secret=hidden"
        )
        self.assertEqual(message, "东方财富接口返回 502 Bad Gateway")

    def test_daily_update_only_runs_for_a_new_complete_trading_day(self) -> None:
        self.assertTrue(
            has_new_complete_trading_day(
                "2026-10-27",
                {"expectedTradingDate": "2026-10-26"},
            )
        )
        self.assertFalse(
            has_new_complete_trading_day(
                "2026-10-26",
                {"expectedTradingDate": "2026-10-26"},
            )
        )
        self.assertTrue(has_new_complete_trading_day("2026-10-26", {}))

    def test_noon_never_includes_current_day(self) -> None:
        current = date(2026, 10, 24)
        self.assertEqual(cutoff_for_session("noon", current), date(2026, 10, 23))
        self.assertEqual(cutoff_for_session("close", current), current)

    def test_manual_before_close_only_uses_previous_day(self) -> None:
        current = date(2026, 10, 27)
        for session in ("manual", "retry", "daily", "close"):
            self.assertEqual(
                cutoff_for_session(session, current, 10), date(2026, 10, 26),
            )
            self.assertEqual(cutoff_for_session(session, current, 23), current)

    def test_kline_parser_uses_real_ohlc_and_sorts(self) -> None:
        payload = {
            "data": {
                "klines": [
                    "2026-10-24,1.0,1.1,1.2,0.9",
                    "2026-10-23,0.9,1.0,1.1,0.8",
                ]
            }
        }
        rows = kline_rows(payload)
        self.assertEqual([row["date"] for row in rows], ["2026-10-23", "2026-10-24"])
        self.assertEqual(rows[-1]["high"], 1.2)

    def test_invalid_ohlc_is_rejected(self) -> None:
        with self.assertRaises(ValueError):
            validate(
                [
                    {
                        "date": "2026-10-24",
                        "open": 1.0,
                        "close": 1.1,
                        "high": 1.05,
                        "low": 0.9,
                    }
                ]
            )

    def test_merge_replaces_same_day_and_keeps_order(self) -> None:
        old = [{"date": "2026-10-23", "close": 1.0}]
        new = [{"date": "2026-10-23", "close": 1.1}, {"date": "2026-10-24", "close": 1.2}]
        result = merged(old, new)
        self.assertEqual([row["date"] for row in result], ["2026-10-23", "2026-10-24"])
        self.assertEqual(result[0]["close"], 1.1)

    @patch("update.time.sleep")
    @patch("update.write_json")
    @patch("update.update_pe", return_value=("无需更新", "2026-10-24"))
    @patch("update.update_price", return_value=("无需更新", "2026-10-24"))
    def test_update_records_batches_and_progress(
        self, _price, _pe, write_json, sleep
    ) -> None:
        selected = [
            {"code": "512760", "name": "芯片ETF", "trackingIndexCode": "A"},
            {"code": "513090", "name": "港股ETF", "trackingIndexCode": "B"},
            {"code": "159796", "name": "消费ETF", "trackingIndexCode": "C"},
        ]
        report = run_update(
            selected,
            cutoff_date=date(2026, 10, 24),
            delay=0,
            batch_size=2,
            batch_pause=20,
        )
        self.assertEqual(report["batchSize"], 2)
        self.assertEqual(report["batchCount"], 2)
        self.assertEqual(report["completed"], 3)
        self.assertEqual([row["batch"] for row in report["results"]], [1, 1, 2])
        self.assertIn(20, [call.args[0] for call in sleep.call_args_list])
        progress = write_json.call_args_list[-1].args[1]
        self.assertEqual(progress["completed"], 3)
        self.assertEqual(progress["total"], 3)


class IncrementalCacheTest(unittest.TestCase):
    def setUp(self) -> None:
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        for name, value in (
            ("PRICE", self.root / "prices"),
            ("PE", self.root / "pe"),
            ("RAW_PRICE", self.root / "raw_prices"),
            ("RAW_PE", self.root / "raw_pe"),
        ):
            handle = patch.object(updater, name, value)
            handle.start()
            self.addCleanup(handle.stop)
        self.old_price = {
            "date": "2026-10-23", "open": 1.0, "close": 1.1, "high": 1.2, "low": 0.9,
        }

    @patch("update.eastmoney_kline_request")
    def test_price_requests_next_day_only_and_keeps_old_values(self, request) -> None:
        updater.write_json(updater.PRICE / "512760.json", {"prices": [self.old_price]})
        request.return_value = (
            {"data": {"klines": [
                "2026-10-23,5,5,5,5",  # A provider ignoring beg cannot overwrite old dates.
                "2026-10-26,1.1,1.2,1.3,1.0",
                "2026-10-27,1.2,1.3,1.4,1.1",  # Not yet closed.
            ]}},
            "东方财富备用接口",
        )
        result = updater.update_price("512760", date(2026, 10, 26))
        params = parse_qs(request.call_args.args[0])
        self.assertEqual(params["beg"], ["20261024"])
        self.assertEqual(params["end"], ["20261026"])
        self.assertEqual(params["fqt"], ["1"])
        saved = updater.read_cache(updater.PRICE / "512760.json", "prices")
        self.assertEqual(result, ("新增1", "2026-10-26"))
        self.assertEqual(saved["prices"][0], self.old_price)
        self.assertEqual(len(saved["prices"]), 2)

    @patch("update.request_json")
    def test_pe_requests_next_day_only_and_keeps_old_values(self, request) -> None:
        old = {"date": "2026-10-23", "peTTM": 20.0}
        updater.write_json(updater.PE / "990001.json", {"points": [old]})
        request.return_value = {"data": [
            {"tradeDate": "20261023", "peg": 99},
            {"tradeDate": "20261026", "peg": 21},
            {"tradeDate": "20261027", "peg": 22},
        ]}
        updater.update_pe("990001", True, date(2026, 10, 26))
        params = parse_qs(urlsplit(request.call_args.args[0]).query)
        self.assertEqual(params["startDate"], ["20261024"])
        self.assertEqual(params["endDate"], ["20261026"])
        saved = updater.read_cache(updater.PE / "990001.json", "points")
        self.assertEqual(saved["points"], [old, {"date": "2026-10-26", "peTTM": 21.0}])

    @patch("update.eastmoney_kline_request")
    @patch("update.request_json")
    def test_complete_caches_do_not_request_network(self, pe_request, price_request) -> None:
        updater.write_json(updater.PRICE / "512760.json", {"prices": [self.old_price]})
        updater.write_json(updater.PE / "990001.json", {
            "points": [{"date": "2026-10-23", "peTTM": 20.0}],
        })
        updater.update_price("512760", date(2026, 10, 23))
        updater.update_pe("990001", True, date(2026, 10, 23))
        price_request.assert_not_called()
        pe_request.assert_not_called()

    @patch("update.eastmoney_kline_request")
    def test_only_new_etf_fetches_initial_history(self, request) -> None:
        request.return_value = (
            {"data": {"klines": ["2026-10-26,1,1,1,1"]}}, "东方财富主接口",
        )
        updater.update_price("512760", date(2026, 10, 26))
        self.assertEqual(parse_qs(request.call_args.args[0])["beg"], ["20200101"])

    @patch("update.request_json")
    def test_broken_existing_cache_must_not_trigger_full_download(self, request) -> None:
        updater.write_json(updater.PRICE / "512760.json", {"wrongField": []})
        with self.assertRaisesRegex(ValueError, "保留原文件"):
            updater.update_price("512760", date(2026, 10, 26))
        request.assert_not_called()

    def test_failed_request_keeps_existing_file_unchanged(self) -> None:
        path = updater.PE / "990001.json"
        updater.write_json(path, {"points": [{"date": "2026-10-23", "peTTM": 20}]})
        previous = path.read_bytes()
        with patch("update.request_json", side_effect=RuntimeError("502")):
            with self.assertRaises(RuntimeError):
                updater.update_pe("990001", True, date(2026, 10, 26))
        self.assertEqual(path.read_bytes(), previous)


class PublisherHelpersTest(unittest.TestCase):
    def test_missing_context_must_not_mark_old_cache_as_current(self) -> None:
        stale, reason = publisher_helpers.freshness_flags(
            "2026-07-31", "2026-07-31", "", True
        )
        self.assertTrue(stale)
        self.assertIn("尚未联网确认", reason)

    def test_price_validation_and_pe_cleanup(self) -> None:
        prices = publisher_helpers.validate_prices(
            [
                {
                    "date": "2026-10-24",
                    "open": 1.0,
                    "close": 1.2,
                    "high": 1.3,
                    "low": 0.9,
                }
            ]
        )
        self.assertEqual(prices[0]["high"], 1.3)
        pe = publisher_helpers.clean_pe(
            [
                {"date": "2015-12-31", "peTTM": 12},
                {"date": "2026-10-24", "peTTM": 20},
            ]
        )
        self.assertEqual(pe, [{"date": "2026-10-24", "pe_ttm": 20.0}])

    def test_stale_status_uses_expected_trading_date(self) -> None:
        stale, reason = publisher_helpers.freshness_flags(
            "2026-10-22",
            "2026-10-23",
            "2026-10-23",
            True,
        )
        self.assertTrue(stale)
        self.assertIn("日K截至 2026-10-22", reason)
        stale, reason = publisher_helpers.freshness_flags(
            "2026-10-23",
            "2026-10-23",
            "2026-10-23",
            True,
        )
        self.assertFalse(stale)
        self.assertEqual(reason, "")


if __name__ == "__main__":
    unittest.main()
