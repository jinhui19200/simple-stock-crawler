#!/usr/bin/env python3
"""Persist a finished cloud batch so an interrupted run never loses its cache."""
from __future__ import annotations

import os
import subprocess
from pathlib import Path


def checkpoint() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true":
        raise RuntimeError("批次 Git 检查点仅允许在 GitHub Actions 内运行")
    project = Path(__file__).resolve().parents[1]
    branch = os.environ["GITHUB_REF_NAME"]

    def git(*args: str, check: bool = True):
        return subprocess.run(["git", *args], cwd=project, check=check, timeout=90)

    git("config", "user.name", "github-actions[bot]")
    git("config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com")
    git("add", "-A", "collector/output/etf_price", "collector/output/index_pe",
        "collector/output/update_report.json", "collector/output/run_context.json")
    changed = git("diff", "--cached", "--quiet", check=False)
    if changed.returncode == 1:
        git("commit", "-m", "data: save incremental ETF batch")
    elif changed.returncode:
        changed.check_returncode()
    git("pull", "--rebase", "origin", branch)
    git("push", "origin", f"HEAD:{branch}")


if __name__ == "__main__":
    checkpoint()
