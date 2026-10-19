"""Executes a run's stages in order on a background thread.

Two modes:
- Demo (LILAC_DEMO=1, the default): stages advance on a timer with realistic log lines and the
  results come from app.demo. Nothing external is required.
- Real: each stage's commands (pipeline/commands.py) run as subprocesses in the run's work
  directory, with output streamed to logs/<stage>.log.

Manual annotation pauses the run in `needs_input` until labels are saved; `resume()` picks up
from the annotation stage.

For production, replace the thread with a job queue (Celery, RQ) or hand the stage commands
to Nextflow/Snakemake; the stage catalog and command builders stay the same.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
from typing import Callable

from .. import demo
from ..config import settings
from ..models import Run, StageStatus, now
from ..store import RunStore
from . import commands
from .stages import STAGE_BY_ID, STAGES, compatibility_notes

_threads: dict[str, threading.Thread] = {}
_cancel: dict[str, threading.Event] = {}


class ConfigError(ValueError):
    pass


def validate(run: Run) -> list[dict[str, str]]:
    """Raise ConfigError for anything that would fail; return non-blocking notes."""
    for sid, stage in STAGE_BY_ID.items():
        c = run.config.get(sid)
        if c is None:
            raise ConfigError(f"Missing configuration for {stage.name}.")
        if not c.enabled:
            if not stage.optional:
                raise ConfigError(f"{stage.name} can't be skipped.")
            continue
        tool = next((t for t in stage.tools if t.id == c.tool), None)
        if tool is None:
            raise ConfigError(f"{c.tool} isn't a tool for {stage.name}.")
        if not tool.available:
            raise ConfigError(f"{tool.label} for {stage.name} isn't available yet. Choose {stage.default_tool}.")
    if run.input_type == "fastq" and run.config["demux"].enabled:
        raise ConfigError("Demultiplexing needs BCL input. Turn it off when starting from FASTQ files.")
    conditions = {s.condition for s in run.samples}
    if len(conditions) < 2:
        raise ConfigError("Differential expression needs at least two conditions.")
    for cond in conditions:
        if sum(1 for s in run.samples if s.condition == cond) < 2:
            raise ConfigError(f"“{cond}” has one sample. Pseudobulk DE needs at least two replicates per condition.")
    ref = run.config["de"].params.get("reference")
    if ref not in conditions:
        raise ConfigError(f"Reference condition “{ref}” doesn't match any sample's condition.")
    return compatibility_notes({k: v.model_dump() for k, v in run.config.items()})


def initial_stages(run: Run) -> list[StageStatus]:
    return [
        StageStatus(id=s.id, state="pending" if run.config[s.id].enabled else "skipped")
        for s in STAGES
    ]


def write_params(store: RunStore, run: Run) -> None:
    params = {
        "run_id": run.id,
        "work_dir": str(store.work_dir(run.id)),
        "organism": run.organism,
        "reference": run.reference,
        "samples": [s.model_dump() for s in run.samples],
        "config": {k: v.model_dump() for k, v in run.config.items()},
        "annotations": _load_annotations(store, run.id),
    }
    (store.work_dir(run.id)).mkdir(parents=True, exist_ok=True)
    (store.work_dir(run.id) / "params.json").write_text(json.dumps(params, indent=2))


def _load_annotations(store: RunStore, run_id: str) -> dict[str, str]:
    path = store.dir(run_id) / "annotations.json"
    return json.loads(path.read_text()) if path.exists() else {}


def start(store: RunStore, run_id: str, from_stage: str | None = None) -> None:
    if run_id in _threads and _threads[run_id].is_alive():
        return
    _cancel[run_id] = threading.Event()
    t = threading.Thread(target=_execute, args=(store, run_id, from_stage), daemon=True, name=f"run-{run_id}")
    _threads[run_id] = t
    t.start()


def cancel(run_id: str) -> None:
    if run_id in _cancel:
        _cancel[run_id].set()


def resume(store: RunStore, run_id: str) -> None:
    start(store, run_id, from_stage="annotate")


def _execute(store: RunStore, run_id: str, from_stage: str | None) -> None:
    run = store.get(run_id)
    run.state = "running"
    store.save(run)
    write_params(store, run)
    started = from_stage is None
    stop = _cancel[run_id]

    for status in run.stages:
        if not started:
            started = status.id == from_stage
            if not started:
                continue
        if status.state == "skipped":
            continue
        if stop.is_set():
            _finish(store, run_id, "cancelled")
            return

        _set(store, run_id, status.id, state="running", started_at=now(), progress=0.0, message="Starting")
        try:
            if run.demo or settings.demo_mode:
                outcome = _demo_stage(store, run, status.id, stop)
            else:
                outcome = _real_stage(store, run, status.id, stop)
        except Exception as exc:  # surface the reason in the app, then stop the run
            store.append_log(run_id, status.id, f"ERROR {exc}")
            _set(store, run_id, status.id, state="failed", finished_at=now(), message=str(exc))
            _finish(store, run_id, "failed")
            return

        if outcome == "needs_input":
            _set(store, run_id, status.id, state="needs_input", progress=1.0,
                 message="Name each cluster to continue")
            _finish(store, run_id, "needs_input")
            return
        if outcome == "cancelled":
            _set(store, run_id, status.id, state="failed", message="Cancelled")
            _finish(store, run_id, "cancelled")
            return
        _set(store, run_id, status.id, state="done", finished_at=now(), progress=1.0, message="Complete")
        run = store.get(run_id)

    _finish(store, run_id, "done")


def _set(store: RunStore, run_id: str, stage: str, **fields) -> None:
    run = store.get(run_id)
    for s in run.stages:
        if s.id == stage:
            for k, v in fields.items():
                setattr(s, k, v)
    if fields.get("state") == "running":
        run.state = "running"
    store.save(run)


def _finish(store: RunStore, run_id: str, state: str) -> None:
    run = store.get(run_id)
    run.state = state  # type: ignore[assignment]
    store.save(run)


# ----------------------------------------------------------------------------- demo mode

DEMO_LOG: dict[str, list[str]] = {
    "demux": ["bcl-convert v4.3.6", "Parsing SampleSheet.csv: 6 samples, 2 lanes",
              "Converting tiles 1101–2678", "Writing FASTQ files (no lane splitting)",
              "Undetermined reads: 2.1%"],
    "read_qc": ["FastQC v0.12.1 on 12 files", "Per-base quality: pass on all files",
                "Adapter content below 2.5% on all files", "MultiQC v1.25: aggregating 12 reports"],
    "align": ["STAR 2.7.11b --soloType CB_UMI_Simple", "Loading genome GRCh38-2024-A",
              "Mapping Donor1_Ctrl … Donor3_IFNb", "EmptyDrops_CR cell calling", "Writing Solo.out matrices"],
    "ambient": ["SoupX 1.6.2", "Quick clustering for contamination estimate",
                "autoEstCont: estimated ρ between 0.03 and 0.10", "adjustCounts(roundToInt = TRUE)"],
    "cell_qc": ["Seurat 5.2.1", "Computing percent.mt (^MT-)",
                "Filter: 200 ≤ nFeature ≤ 6000, percent.mt ≤ 15", "JoinLayers"],
    "doublets": ["scDblFinder 1.20", "Simulating artificial doublets per sample",
                 "Classifying droplets", "Keeping singlets"],
    "normalize": ["NormalizeData(LogNormalize, scale.factor = 10000)", "Splitting layers by sample",
                  "FindVariableFeatures(vst, nfeatures = 2000)", "ScaleData"],
    "cluster": ["RunPCA(npcs = 30)", "IntegrateLayers(CCAIntegration)", "FindNeighbors(dims = 1:30)",
                "FindClusters(resolution = 0.5): 9 clusters", "RunUMAP(min.dist = 0.3)", "JoinLayers",
                "FindAllMarkers"],
    "annotate": ["FeaturePlot of 12 canonical markers", "DotPlot by cluster",
                 "Suggested labels ready for review"],
    "de": ["AggregateExpression by cell type × sample", "54 pseudobulk profiles, 9 cell types",
           "DESeq2 ~ condition, reference = Control", "lfcShrink(apeglm)", "Writing DE tables"],
}


def _demo_stage(store: RunStore, run: Run, stage: str, stop: threading.Event) -> str:
    lines = DEMO_LOG.get(stage, ["Working"])
    steps = len(lines)
    pause = settings.demo_stage_seconds / max(steps, 1)
    if stage == "annotate" and run.config["annotate"].tool == "seurat_markers" \
            and not _load_annotations(store, run.id):
        for line in lines:
            store.append_log(run.id, stage, line)
        return "needs_input"
    for i, line in enumerate(lines):
        if stop.is_set():
            return "cancelled"
        store.append_log(run.id, stage, line)
        _set(store, run.id, stage, progress=(i + 1) / steps, message=line)
        time.sleep(pause)
    if stage == "annotate" and run.config["annotate"].tool == "celltypist":
        labels = {c["id"]: c["suggested_label"] for c in demo.umap(run.id)["clusters"]}
        (store.dir(run.id) / "annotations.json").write_text(json.dumps(labels, indent=2))
    return "done"


# ----------------------------------------------------------------------------- real mode

def _real_stage(store: RunStore, run: Run, stage: str, stop: threading.Event) -> str:
    work = store.work_dir(run.id)
    write_params(store, run)
    for argv in commands.build(run, stage, work):
        if stop.is_set():
            return "cancelled"
        store.append_log(run.id, stage, "$ " + " ".join(argv))
        _stream(argv, cwd=str(work), log=lambda line: store.append_log(run.id, stage, line), stop=stop)
    if stage == "annotate" and run.config["annotate"].tool == "seurat_markers" \
            and not _load_annotations(store, run.id):
        return "needs_input"
    return "done"


def _stream(argv: list[str], cwd: str, log: Callable[[str], None], stop: threading.Event) -> None:
    proc = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    assert proc.stdout is not None
    for line in proc.stdout:
        log(line)
        if stop.is_set():
            proc.terminate()
            break
    code = proc.wait()
    if code != 0 and not stop.is_set():
        raise RuntimeError(f"{argv[0]} exited with code {code}. See the stage log for details.")
