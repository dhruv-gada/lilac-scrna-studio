"""Lilac scRNA Studio API.

Run locally:  uvicorn app.main:app --reload --port 8000
Docs:         http://localhost:8000/docs
"""

from __future__ import annotations

import json
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import demo, results
from .config import settings
from .models import AnnotationUpdate, Run, RunCreate, RunSummary
from .pipeline import runner
from .pipeline.stages import STAGES, compatibility_notes, standard_preset
from .store import store

@asynccontextmanager
async def lifespan(_: FastAPI):
    # A hosted demo starts with one finished run so every screen has something to show.
    if settings.demo_mode and os.environ.get("LILAC_SEED_DEMO", "1") == "1" and not store.list():
        seed_finished_demo_run()
    yield


app = FastAPI(title="Lilac scRNA Studio", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get(run_id: str) -> Run:
    try:
        return store.get(run_id)
    except KeyError:
        raise HTTPException(404, f"No run with ID {run_id}.")


def _summary(run: Run) -> RunSummary:
    active = [s for s in run.stages if s.state != "skipped"]
    done = sum(1 for s in active if s.state == "done") + sum(s.progress for s in active if s.state == "running")
    current = next((s.id for s in run.stages if s.state in ("running", "needs_input", "failed")), None)
    cells = None
    if run.demo and any(s.id == "doublets" and s.state == "done" for s in run.stages):
        cells = demo.cell_qc(run.id, demo.alignment(run.id))["funnel"][-1]["cells"]
    return RunSummary(
        id=run.id, name=run.name, description=run.description, state=run.state,
        created_at=run.created_at, updated_at=run.updated_at, n_samples=len(run.samples),
        conditions=sorted({s.condition for s in run.samples}),
        progress=round(done / max(len(active), 1), 3), current_stage=current, cells=cells, demo=run.demo,
        stages=[{"id": s.id, "state": s.state} for s in run.stages],
    )


# ----------------------------------------------------------------------------- catalog

@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "demo_mode": settings.demo_mode}


@app.get("/api/pipeline/stages")
def stages() -> dict[str, Any]:
    return {"stages": [s.model_dump() for s in STAGES], "standard_preset": standard_preset()}


@app.post("/api/pipeline/check")
def check(config: dict[str, dict[str, Any]]) -> dict[str, Any]:
    return {"notes": compatibility_notes(config)}


# ----------------------------------------------------------------------------- runs

@app.get("/api/runs", response_model=list[RunSummary])
def list_runs() -> list[RunSummary]:
    return [_summary(r) for r in store.list()]


@app.post("/api/runs", response_model=Run, status_code=201)
def create_run(body: RunCreate, start: bool = True) -> Run:
    run = Run(**body.model_dump(), id=store.new_id(), demo=settings.demo_mode)
    try:
        runner.validate(run)
    except runner.ConfigError as exc:
        raise HTTPException(422, str(exc))
    run.stages = runner.initial_stages(run)
    run.state = "queued" if start else "draft"
    store.save(run)
    if start:
        runner.start(store, run.id)
    return run


@app.post("/api/runs/demo", response_model=Run, status_code=201)
def create_demo_run() -> Run:
    """A ready-made run on the synthetic PBMC dataset, for trying the app."""
    body = RunCreate(
        name="PBMC · IFN-β stimulation",
        description="Three donors, control vs IFN-β, 10x 3′ v3.",
        input_type="bcl", input_path="/data/bcl/241018_A01234_0456_BHXYZDSX7",
        samples=[{"id": s["id"], "condition": s["condition"], "replicate": s["replicate"]} for s in demo.SAMPLES],
        config=standard_preset(),
    )
    body.config["de"].params["reference"] = "Control"
    run = Run(**body.model_dump(), id=store.new_id(), demo=True)
    run.stages = runner.initial_stages(run)
    run.state = "queued"
    store.save(run)
    runner.start(store, run.id)
    return run


@app.get("/api/runs/{run_id}", response_model=Run)
def get_run(run_id: str) -> Run:
    return _get(run_id)


@app.post("/api/runs/{run_id}/start", response_model=Run)
def start_run(run_id: str) -> Run:
    run = _get(run_id)
    if run.state not in ("draft", "failed", "cancelled"):
        raise HTTPException(409, f"Run is {run.state}.")
    failed = next((s.id for s in run.stages if s.state == "failed"), None)
    runner.start(store, run_id, from_stage=failed)
    return store.get(run_id)


@app.post("/api/runs/{run_id}/cancel", response_model=Run)
def cancel_run(run_id: str) -> Run:
    _get(run_id)
    runner.cancel(run_id)
    return store.get(run_id)


@app.get("/api/runs/{run_id}/logs/{stage}")
def logs(run_id: str, stage: str, tail: int = Query(400, le=5000)) -> dict[str, Any]:
    _get(run_id)
    return {"stage": stage, "lines": store.read_log(run_id, stage, tail)}


@app.put("/api/runs/{run_id}/annotations", response_model=Run)
def save_annotations(run_id: str, body: AnnotationUpdate) -> Run:
    run = _get(run_id)
    labels = {k: v.strip() for k, v in body.labels.items() if v.strip()}
    if not labels:
        raise HTTPException(422, "Give at least one cluster a label.")
    (store.dir(run_id) / "annotations.json").write_text(json.dumps(labels, indent=2))
    if run.state == "needs_input":
        runner.resume(store, run_id)
    return store.get(run_id)


# ----------------------------------------------------------------------------- results

@app.get("/api/runs/{run_id}/results/qc")
def qc(run_id: str) -> dict[str, Any]:
    return results.qc(store, _get(run_id))


@app.get("/api/runs/{run_id}/results/umap")
def umap(run_id: str) -> dict[str, Any]:
    return results.umap(store, _get(run_id))


@app.get("/api/runs/{run_id}/results/markers")
def markers(run_id: str) -> dict[str, Any]:
    return results.markers(store, _get(run_id))


@app.get("/api/runs/{run_id}/results/de")
def de_summary(run_id: str) -> dict[str, Any]:
    return results.de_summary(store, _get(run_id))


@app.get("/api/runs/{run_id}/results/de/{cell_type}")
def de(run_id: str, cell_type: str) -> dict[str, Any]:
    return results.de(store, _get(run_id), cell_type)


def seed_finished_demo_run() -> Run:
    from datetime import timedelta

    from .models import now

    body = RunCreate(
        name="PBMC · IFN-β stimulation",
        description="Three donors, control vs IFN-β (6 h), 10x 3′ v3.",
        input_type="bcl", input_path="/data/bcl/241011_A01234_0451_BHXYZDSX7",
        samples=[{"id": s["id"], "condition": s["condition"], "replicate": s["replicate"]} for s in demo.SAMPLES],
        config=standard_preset(),
    )
    body.config["de"].params["reference"] = "Control"
    run = Run(**body.model_dump(), id="run_pbmc_ifnb", demo=True, state="done")
    run.stages = runner.initial_stages(run)
    t0 = now() - timedelta(days=2)
    for i, st in enumerate(run.stages):
        st.state, st.progress, st.message = "done", 1.0, "Complete"
        st.started_at = t0 + timedelta(minutes=18 * i)
        st.finished_at = t0 + timedelta(minutes=18 * (i + 1))
    store.save(run)
    labels = {c["id"]: c["suggested_label"] for c in demo.umap(run.id)["clusters"]}
    (store.dir(run.id) / "annotations.json").write_text(json.dumps(labels, indent=2))
    for stage, lines in runner.DEMO_LOG.items():
        for line in lines:
            store.append_log(run.id, stage, line)
    return store.get(run.id)


# The built frontend (frontend/dist) is served from the same origin when present.
_web = Path(os.environ.get("LILAC_WEB_DIR", Path(__file__).resolve().parents[2] / "frontend" / "dist"))
if _web.is_dir():
    app.mount("/", StaticFiles(directory=_web, html=True), name="web")
