"""Results served to the app, gated on the stage that produces them.

Demo runs read from app.demo. Real runs read the files the stage scripts write under
<work>/results (see pipeline/scripts/).
"""

from __future__ import annotations

import csv
import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from . import demo
from .models import Run
from .store import RunStore


def _require(run: Run, *stages: str) -> None:
    states = {s.id: s.state for s in run.stages}
    for stage in stages:
        if states.get(stage) not in ("done", "needs_input", "skipped"):
            raise HTTPException(409, f"Results appear after the {stage} stage finishes.")


def _labels(store: RunStore, run: Run) -> dict[str, str]:
    path = store.dir(run.id) / "annotations.json"
    return json.loads(path.read_text()) if path.exists() else {}


@lru_cache(maxsize=16)
def _demo_umap(run_id: str) -> dict[str, Any]:
    return demo.umap(run_id)


def _read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        raise HTTPException(404, f"{path.name} hasn't been written yet.")
    with path.open() as f:
        return list(csv.DictReader(f))


def qc(store: RunStore, run: Run) -> dict[str, Any]:
    states = {s.id: s.state for s in run.stages}
    out: dict[str, Any] = {}
    if run.demo:
        # Synthetic tables are generated for six samples; relabel them with this run's samples.
        ids = [s.id for s in run.samples]
        relabel = lambda rows: [{**rows[i % len(rows)], "sample": sid} for i, sid in enumerate(ids)]
        align = demo.alignment(run.id)
        if states.get("read_qc") == "done":
            out["read_qc"] = relabel(demo.read_qc(run.id))
        if states.get("align") in ("done",):
            out["alignment"] = relabel(align)
        if states.get("doublets") == "done":
            cq = demo.cell_qc(run.id, align)
            scale = len(ids) / len(demo.SAMPLES)
            cq["samples"] = relabel(cq["samples"])
            cq["funnel"] = [{**f, "cells": round(f["cells"] * scale)} for f in cq["funnel"]]
            p = run.config["cell_qc"].params
            cq["thresholds"] = {k: p.get(k, v) for k, v in cq["thresholds"].items()}
            out["cell_qc"] = cq
        return out
    res = store.work_dir(run.id) / "results"
    for name in ("ambient.json", "cell_qc.json", "doublets.json"):
        if (res / name).exists():
            out[name.removesuffix(".json")] = json.loads((res / name).read_text())
    mqc = store.work_dir(run.id) / "qc" / "multiqc" / "multiqc_data" / "multiqc_data.json"
    if mqc.exists():
        out["multiqc"] = json.loads(mqc.read_text()).get("report_general_stats_data", [])
    return out


def umap(store: RunStore, run: Run) -> dict[str, Any]:
    _require(run, "cluster")
    labels = _labels(store, run)
    if run.demo:
        data = dict(_demo_umap(run.id))
        n = len(run.samples)
        data["samples"] = [s.model_dump() for s in run.samples]
        if n != len(demo.SAMPLES):
            data["sample"] = [i % n for i in data["sample"]]
    else:
        rows = _read_csv(store.work_dir(run.id) / "results" / "umap.csv")
        sample_ids = [s.id for s in run.samples]
        cluster_ids = sorted({r["cluster"] for r in rows}, key=lambda c: int(c) if c.isdigit() else c)
        data = {
            "x": [round(float(r["x"]), 3) for r in rows],
            "y": [round(float(r["y"]), 3) for r in rows],
            "cluster": [cluster_ids.index(r["cluster"]) for r in rows],
            "sample": [sample_ids.index(r["sample"]) for r in rows],
            "samples": [s.model_dump() for s in run.samples],
            "clusters": [{"id": c, "n": sum(1 for r in rows if r["cluster"] == c), "suggested_label": None}
                         for c in cluster_ids],
            "features": {},
        }
    data["labels"] = labels
    return data


def markers(store: RunStore, run: Run) -> dict[str, Any]:
    _require(run, "cluster")
    if run.demo:
        return demo.markers(run.id)
    rows = _read_csv(store.work_dir(run.id) / "results" / "cluster_markers.csv")
    return {"table": [{"cluster": r["cluster"], "gene": r["gene"], "avg_log2fc": float(r["avg_log2FC"]),
                       "pct_1": float(r["pct.1"]), "pct_2": float(r["pct.2"]),
                       "p_val_adj": float(r["p_val_adj"])} for r in rows]}


def _cell_types(store: RunStore, run: Run) -> list[str]:
    labels = _labels(store, run)
    seen: dict[str, None] = {}
    for v in labels.values():
        seen.setdefault(v, None)
    return list(seen)


def de_summary(store: RunStore, run: Run) -> dict[str, Any]:
    _require(run, "de")
    p = run.config["de"].params
    if run.demo:
        out = []
        for ct in _cell_types(store, run):
            res = demo.de(run.id, ct)
            up = sum(1 for g in res["genes"] if g["padj"] < p["padj"] and g["log2fc"] >= p["lfc"])
            down = sum(1 for g in res["genes"] if g["padj"] < p["padj"] and g["log2fc"] <= -p["lfc"])
            out.append({"cell_type": ct, "up": up, "down": down, "tested": len(res["genes"])})
        return {"cutoffs": {"padj": p["padj"], "lfc": p["lfc"]}, "cell_types": out}
    path = store.work_dir(run.id) / "results" / "de_summary.json"
    if not path.exists():
        raise HTTPException(404, "DE summary hasn't been written yet.")
    summary = json.loads(path.read_text())
    return {"cutoffs": {"padj": p["padj"], "lfc": p["lfc"]},
            "cell_types": [{"cell_type": k, **v} for k, v in summary.items()]}


def de(store: RunStore, run: Run, cell_type: str) -> dict[str, Any]:
    _require(run, "de")
    if cell_type not in _cell_types(store, run):
        raise HTTPException(404, f"No cell type named {cell_type}.")
    if run.demo:
        res = demo.de(run.id, cell_type)
        ref = str(run.config["de"].params.get("reference"))
        test = next((s.condition for s in run.samples if s.condition != ref), "")
        res["contrast"] = {"factor": "condition", "test": test, "reference": ref}
        rng = demo._rng(run.id + cell_type + "heat")
        rows = []
        for g in res["genes"][:24]:
            vals = [(-0.85 if s.condition == ref else 0.85) * (1 if g["log2fc"] > 0 else -1) + rng.normal(0, 0.3)
                    for s in run.samples]
            m = sum(vals) / len(vals)
            sd = (sum((v - m) ** 2 for v in vals) / len(vals)) ** 0.5 or 1
            rows.append({"gene": g["gene"], "values": [round((v - m) / sd, 2) for v in vals]})
        res["heatmap"] = {"samples": [s.id for s in run.samples], "rows": rows}
        return res
    import re
    safe = re.sub(r"[^A-Za-z0-9]+", "-", cell_type)
    rows = _read_csv(store.work_dir(run.id) / "results" / "de" / f"{safe}.csv")
    genes = [{"gene": r["gene"], "log2fc": float(r["log2fc"] or 0), "pvalue": float(r["pvalue"] or 1),
              "padj": float(r["padj"]) if r["padj"] not in ("", "NA") else 1.0,
              "base_mean": float(r["base_mean"])} for r in rows]
    return {"cell_type": cell_type, "genes": genes}
