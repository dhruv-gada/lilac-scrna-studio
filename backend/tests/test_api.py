import os
import time

import pytest

os.environ.setdefault("LILAC_DEMO", "1")
os.environ["LILAC_DEMO_STAGE_SECONDS"] = "0.02"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from fastapi.testclient import TestClient

    from app import main, store as store_mod

    s = store_mod.RunStore(tmp_path)
    monkeypatch.setattr(main, "store", s)
    return TestClient(main.app), s


def wait_for(client, run_id, states, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        run = client.get(f"/api/runs/{run_id}").json()
        if run["state"] in states:
            return run
        time.sleep(0.05)
    raise AssertionError(f"run stuck in {run['state']}")


def test_catalog_has_ten_stages_with_seurat_defaults(client):
    c, _ = client
    data = c.get("/api/pipeline/stages").json()
    assert [s["order"] for s in data["stages"]] == list(range(1, 11))
    preset = data["standard_preset"]
    for stage in ("cell_qc", "normalize", "cluster"):
        assert preset[stage]["tool"] == "seurat"
    assert preset["de"]["tool"] == "deseq2"


def test_demo_run_pauses_for_annotation_then_finishes(client):
    c, _ = client
    run = c.post("/api/runs/demo").json()
    run = wait_for(c, run["id"], {"needs_input", "failed"})
    assert run["state"] == "needs_input"
    assert next(s for s in run["stages"] if s["id"] == "annotate")["state"] == "needs_input"

    umap = c.get(f"/api/runs/{run['id']}/results/umap").json()
    assert len(umap["x"]) == len(umap["cluster"]) > 1000
    labels = {cl["id"]: cl["suggested_label"] for cl in umap["clusters"]}
    assert c.get(f"/api/runs/{run['id']}/results/de").status_code == 409

    c.put(f"/api/runs/{run['id']}/annotations", json={"labels": labels})
    run = wait_for(c, run["id"], {"done", "failed"})
    assert run["state"] == "done"

    summary = c.get(f"/api/runs/{run['id']}/results/de").json()
    assert {r["cell_type"] for r in summary["cell_types"]} == set(labels.values())
    mono = c.get(f"/api/runs/{run['id']}/results/de/CD14 Monocyte").json()
    top = mono["genes"][0]
    assert top["padj"] < 1e-5
    assert len(mono["heatmap"]["rows"]) == 24


def test_validation_rejects_single_replicate(client):
    c, _ = client
    preset = c.get("/api/pipeline/stages").json()["standard_preset"]
    body = {
        "name": "bad", "input_type": "fastq", "input_path": "/x",
        "samples": [{"id": "A", "condition": "Control"}, {"id": "B", "condition": "Treated"},
                    {"id": "C", "condition": "Treated"}],
        "config": {**preset, "demux": {**preset["demux"], "enabled": False}},
    }
    r = c.post("/api/runs", json=body)
    assert r.status_code == 422
    assert "one sample" in r.json()["detail"]


def test_unavailable_tool_is_rejected(client):
    c, _ = client
    preset = c.get("/api/pipeline/stages").json()["standard_preset"]
    preset["cluster"]["tool"] = "scanpy"
    body = {
        "name": "x", "input_type": "bcl", "input_path": "/x",
        "samples": [{"id": f"S{i}", "condition": "Control" if i < 2 else "Treated"} for i in range(4)],
        "config": preset,
    }
    r = c.post("/api/runs", json=body)
    assert r.status_code == 422 and "isn't available yet" in r.json()["detail"]


def test_starsolo_command_uses_cdna_read_first(tmp_path):
    from app.models import Run
    from app.pipeline import commands
    from app.pipeline.stages import standard_preset

    fq = tmp_path / "fastq"
    fq.mkdir()
    for r in ("R1", "R2"):
        (fq / f"S1_S1_{r}_001.fastq.gz").touch()
    run = Run(id="run_test", name="t", input_type="fastq", input_path=str(fq),
              samples=[{"id": "S1", "condition": "A"}], config=standard_preset())
    cmds = commands.build(run, "align", tmp_path)
    star = next(c for c in cmds if c[0] == "STAR")
    files = star[star.index("--readFilesIn") + 1: star.index("--readFilesIn") + 3]
    assert files[0].endswith("R2_001.fastq.gz") and files[1].endswith("R1_001.fastq.gz")
    assert star[star.index("--soloUMIlen") + 1] == "12"
