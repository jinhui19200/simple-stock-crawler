from __future__ import annotations

import sys
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "collector"))

import publish_to_dashboard as publisher_helpers  # noqa: E402
from daily_pipeline import cutoff_for_session  # noqa: E402
from universe_service import (  # noqa: E402
    deduplicate_candidates,
    eligible_profile,
    is_broad,
    is_stock_etf,
    select_universe,
)
from update import kline_rows, merged, validate  # noqa: E402


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
    def test_noon_never_includes_current_day(self) -> None:
        current = date(2026, 10, 24)
        self.assertEqual(cutoff_for_session("noon", current), date(2026, 10, 23))
        self.assertEqual(cutoff_for_session("close", current), current)

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
