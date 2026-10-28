from __future__ import annotations

import os
import subprocess
import sys
import unittest
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "collector"))
import update as updater
from finalize_interrupted_update import finalize


class SourceProtectionTest(unittest.TestCase):
    def setUp(self):
        updater.PRICE_SOURCE_FAILURES.clear()
        self.addCleanup(updater.PRICE_SOURCE_FAILURES.clear)
        environment = patch.dict(os.environ, {"ETF_CIRCUIT_BREAKER": "true"})
        environment.start()
        self.addCleanup(environment.stop)

    @patch("update.time.monotonic", return_value=100)
    def test_repeated_failure_pauses_then_recovers(self, clock):
        request = Mock(side_effect=RuntimeError("502"))
        for _ in range(2):
            with self.assertRaisesRegex(RuntimeError, "502"):
                updater.call_price_source("primary", request)
        with self.assertRaisesRegex(RuntimeError, "暂缓该来源"):
            updater.call_price_source("primary", request)
        self.assertEqual(request.call_count, 2)
        clock.return_value = 1001
        request.side_effect = None
        request.return_value = {"valid": True}
        self.assertEqual(updater.call_price_source("primary", request), {"valid": True})
        self.assertEqual(request.call_count, 3)
        self.assertEqual(updater.PRICE_SOURCE_FAILURES["primary"]["failures"], 0)

    def test_success_resets_consecutive_failures(self):
        request = Mock(side_effect=[RuntimeError("502"), "ok", RuntimeError("502"), "ok"])
        for _ in range(2):
            with self.assertRaises(RuntimeError):
                updater.call_price_source("primary", request)
            self.assertEqual(updater.call_price_source("primary", request), "ok")
        self.assertEqual(request.call_count, 4)

    @patch("update.time.monotonic", return_value=100)
    @patch("update.request_json")
    def test_paused_primary_allows_backup(self, request, _clock):
        payload = {"data": {"klines": ["2026-10-26,1,1.1,1.2,0.9"]}}
        def respond(url, headers):
            if url.startswith(updater.EASTMONEY + "?"):
                raise RuntimeError("502")
            return payload
        request.side_effect = respond
        for _ in range(3):
            result, source = updater.eastmoney_kline_request("secid=1.512760", {})
            self.assertEqual(result, payload)
            self.assertEqual(source, "东方财富备用接口")
        primary = [c for c in request.call_args_list if c.args[0].startswith(updater.EASTMONEY + "?")]
        self.assertEqual(len(primary), 2)
        self.assertEqual(request.call_count, 5)

    @patch.dict(os.environ, {"ETF_CIRCUIT_BREAKER": "false"})
    def test_protection_can_be_disabled_for_diagnostics(self):
        request = Mock(side_effect=RuntimeError("502"))
        for _ in range(3):
            with self.assertRaisesRegex(RuntimeError, "502"):
                updater.call_price_source("primary", request)
        self.assertEqual(request.call_count, 3)

    @patch("update.subprocess.run")
    def test_worker_validates_output(self, worker):
        worker.return_value = subprocess.CompletedProcess([], 0, '{"data":{"klines":[]}}', "")
        with self.assertRaisesRegex(ValueError, "未返回有效"):
            updater.akshare_kline_request("512760", "2026-10-24", "2026-10-26")


class InterruptedUpdateTest(unittest.TestCase):
    def setUp(self):
        self.folder = TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.project = Path(self.folder.name)
        self.output = self.project / "collector" / "output"
        environment = patch.dict(os.environ, {"ETF_UPDATE_ATTEMPT": "test-1"})
        environment.start()
        self.addCleanup(environment.stop)
        self.context = {
            "expectedTradingDate": "2026-10-26", "cutoffDate": "2026-10-26",
            "status": "running", "runAttempt": "test-1", "attemptedCount": 3,
        }

    def test_partial_status_and_remaining_count(self):
        updater.write_json(self.output / "run_context.json", self.context)
        updater.write_json(self.output / "update_report.json", {
            "cutoffDate": "2026-10-26", "completed": 2,
            "results": [{"error": ""}, {"error": "502"}],
        })
        context = finalize(self.project)
        self.assertEqual(context["status"], "partial")
        self.assertTrue(context["isPartial"] and context["interrupted"])
        self.assertEqual((context["completedCount"], context["pendingCount"], context["failureCount"]), (2, 1, 1))
        self.assertFalse(context["noNewTradingDay"])

    def test_reject_previous_run_context(self):
        updater.write_json(self.output / "run_context.json", {**self.context, "runAttempt": "old-1"})
        with self.assertRaisesRegex(RuntimeError, "不属于本次任务"):
            finalize(self.project)

    def test_reject_missing_cutoff(self):
        with self.assertRaisesRegex(RuntimeError, "缺少本次预期交易日"):
            finalize(self.project)

    def test_previous_report_cannot_inflate_counts(self):
        updater.write_json(self.output / "run_context.json", self.context)
        updater.write_json(self.output / "update_report.json", {
            "cutoffDate": "2026-10-23", "completed": 100, "results": [{"error": "old"}],
        })
        context = finalize(self.project)
        self.assertEqual((context["completedCount"], context["pendingCount"]), (0, 3))
        self.assertEqual(context["failureCount"], 0)

    def test_abort_first_etf_resets_previous_progress(self):
        path = self.output / "update_report.json"
        updater.write_json(path, {"cutoffDate": "2026-10-26", "completed": 100})
        with patch.object(updater, "REPORT", path), patch("update.update_price", side_effect=KeyboardInterrupt):
            with self.assertRaises(KeyboardInterrupt):
                updater.run_update([{"code": "512760"}], cutoff_date=date(2026, 10, 26), delay=0)
        report = updater.read_json(path, {})
        self.assertEqual((report["completed"], report["total"]), (0, 1))
        self.assertEqual(report["results"], [])

    @patch.dict(os.environ, {"ETF_AKSHARE_MAX_TIME": "30", "ETF_CIRCUIT_BREAKER": "false"})
    @patch("update.subprocess.run", side_effect=subprocess.TimeoutExpired("worker", 30))
    @patch("update.eastmoney_kline_request", side_effect=RuntimeError("502"))
    def test_timeout_preserves_price_cache(self, primary, worker):
        path = self.output / "etf_price" / "512760.json"
        updater.write_json(path, {"prices": [{
            "date": "2026-10-23", "open": 1, "close": 1.1, "high": 1.2, "low": 0.9,
        }]})
        previous = path.read_bytes()
        with patch.object(updater, "PRICE", path.parent):
            with self.assertRaisesRegex(RuntimeError, "AkShare超过30秒"):
                updater.update_price("512760", date(2026, 10, 26))
        self.assertEqual(path.read_bytes(), previous)
        self.assertEqual(worker.call_args.kwargs["timeout"], 30)
        self.assertEqual(worker.call_args.args[0][-2:], ["2026-10-24", "2026-10-26"])


if __name__ == "__main__":
    unittest.main()
