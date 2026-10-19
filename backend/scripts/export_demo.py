"""Write the stage catalog and one synthetic run's results to the frontend's mock data file.

The frontend's preview build runs entirely on this file, so it shares one source of truth
with the API.  Usage:  python scripts/export_demo.py ../frontend/src/mock/demo.json
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import demo  # noqa: E402
from app.pipeline.runner import DEMO_LOG  # noqa: E402
from app.pipeline.stages import STAGES, standard_preset  # noqa: E402

SEED = "run_pbmc_ifnb"


def compact_de(seed: str) -> dict:
    out = {}
    genes = None
    for ct in demo.CELL_TYPES:
        res = demo.de(seed, ct[0])
        by_gene = {g["gene"]: g for g in res["genes"]}
        if genes is None:
            genes = list(by_gene)
        out[ct[0]] = {
            "log2fc": [by_gene[g]["log2fc"] for g in genes],
            "padj": [float(f"{by_gene[g]['padj']:.3g}") for g in genes],
            "base_mean": [round(by_gene[g]["base_mean"]) for g in genes],
            "heatmap": res["heatmap"],
        }
    return {"genes": genes, "by_cell_type": out}


def main(out_path: str) -> None:
    align = demo.alignment(SEED)
    data = {
        "stages": [s.model_dump() for s in STAGES],
        "standard_preset": standard_preset(),
        "samples": demo.SAMPLES,
        "logs": DEMO_LOG,
        "results": {
            "read_qc": demo.read_qc(SEED),
            "alignment": align,
            "cell_qc": demo.cell_qc(SEED, align),
            "umap": demo.umap(SEED),
            "markers": demo.markers(SEED),
            "de": compact_de(SEED),
        },
    }
    Path(out_path).write_text(json.dumps(data, separators=(",", ":")))
    print(f"wrote {out_path} ({Path(out_path).stat().st_size / 1e6:.2f} MB)")


if __name__ == "__main__":
    main(sys.argv[1])
