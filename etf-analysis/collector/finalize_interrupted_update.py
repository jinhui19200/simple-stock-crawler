#!/usr/bin/env python3
"""Mark an interrupted fetch accurately before publishing validated caches."""
import os
from datetime import datetime
from pathlib import Path

from update import read_json, write_json


def finalize(project: Path) -> dict:
    folder = project / "collector" / "output"
    path = folder / "run_context.json"
    context = read_json(path, {})
    if not context.get("expectedTradingDate"):
        raise RuntimeError("缺少本次预期交易日，不能发布中断任务")
    attempt = os.environ.get("ETF_UPDATE_ATTEMPT", "")
    if attempt and context.get("runAttempt") != attempt:
        raise RuntimeError("运行上下文不属于本次任务，保留缓存但不发布旧任务状态")
    if context.get("status") != "running":
        raise RuntimeError("没有本次进行中的抓取任务，不能标记为中断发布")
    report = read_json(folder / "update_report.json", {})
    if report.get("cutoffDate") != context.get("cutoffDate"):
        report = {}
    completed = report.get("completed", 0)
    context.update(
        status="partial", isPartial=True, interrupted=True,
        finishedAt=datetime.now().astimezone().isoformat(timespec="seconds"),
        completedCount=completed,
        pendingCount=max(0, context.get("attemptedCount", 0) - completed),
        failureCount=sum(bool(row.get("error")) for row in report.get("results", [])),
        noNewTradingDay=False,
        interruptionReason="抓取阶段失败或超过45分钟；发布已通过校验的缓存，缺失项保留过旧标记",
    )
    write_json(path, context)
    return context


if __name__ == "__main__":
    finalize(Path(__file__).resolve().parents[1])
