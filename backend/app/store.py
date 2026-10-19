"""File-backed run storage: one folder per run under LILAC_DATA_DIR/runs/<id>/.

    run.json        the Run model (configuration and stage status)
    params.json     what the R/Python scripts read
    logs/<stage>.log
    work/           pipeline outputs (see pipeline/commands.py for the layout)

Good enough for a single server. Swap for Postgres when the app is deployed for a team.
"""

from __future__ import annotations

import json
import secrets
import threading
from pathlib import Path

from .config import settings
from .models import Run, now


class RunStore:
    def __init__(self, root: Path | None = None):
        self.root = (root or settings.data_dir) / "runs"
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()

    def new_id(self) -> str:
        return "run_" + secrets.token_hex(4)

    def dir(self, run_id: str) -> Path:
        if not run_id.startswith("run_") or "/" in run_id or ".." in run_id:
            raise KeyError(run_id)
        return self.root / run_id

    def work_dir(self, run_id: str) -> Path:
        return self.dir(run_id) / "work"

    def log_path(self, run_id: str, stage: str) -> Path:
        return self.dir(run_id) / "logs" / f"{stage}.log"

    def save(self, run: Run) -> Run:
        with self._lock:
            run.updated_at = now()
            d = self.dir(run.id)
            (d / "logs").mkdir(parents=True, exist_ok=True)
            (d / "work").mkdir(exist_ok=True)
            tmp = d / "run.json.tmp"
            tmp.write_text(run.model_dump_json(indent=2))
            tmp.replace(d / "run.json")
        return run

    def get(self, run_id: str) -> Run:
        with self._lock:
            path = self.dir(run_id) / "run.json"
            if not path.exists():
                raise KeyError(run_id)
            return Run.model_validate_json(path.read_text())

    def list(self) -> list[Run]:
        runs = []
        for p in self.root.glob("run_*/run.json"):
            try:
                runs.append(Run.model_validate_json(p.read_text()))
            except Exception:  # a half-written or older file shouldn't break the list
                continue
        return sorted(runs, key=lambda r: r.created_at, reverse=True)

    def append_log(self, run_id: str, stage: str, line: str) -> None:
        path = self.log_path(run_id, stage)
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a") as f:
            f.write(line.rstrip("\n") + "\n")

    def read_log(self, run_id: str, stage: str, tail: int = 400) -> list[str]:
        path = self.log_path(run_id, stage)
        if not path.exists():
            return []
        return path.read_text().splitlines()[-tail:]

    def write_json(self, run_id: str, name: str, data: object) -> None:
        (self.dir(run_id) / name).write_text(json.dumps(data, indent=2, default=str))


store = RunStore()
