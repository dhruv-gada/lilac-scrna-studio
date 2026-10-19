"""Stage 9 (CellTypist), step 2: predict cell types and write cluster labels into params.json.

CellTypist expects log1p-normalized expression at 10,000 counts per cell. With majority voting
on, each cluster takes the most common predicted label, which is what gets written back as the
run's annotations; annotate_markers.R then applies them to the Seurat object.
"""

import json
import sys
from pathlib import Path

import anndata as ad
import celltypist
import pandas as pd
import scanpy as sc
import scipy.io


def main(params_path: str) -> None:
    params = json.loads(Path(params_path).read_text())
    work = Path(params["work_dir"])
    sp = params["config"]["annotate"]["params"]
    src = work / "objects" / "for_python"

    counts = scipy.io.mmread(src / "matrix.mtx").T.tocsr()  # cells × genes
    adata = ad.AnnData(counts)
    adata.var_names = (src / "genes.txt").read_text().split()
    adata.obs_names = (src / "barcodes.txt").read_text().split()
    clusters = pd.read_csv(src / "clusters.csv", index_col="cell")["cluster"].astype(str)
    adata.obs["cluster"] = clusters.reindex(adata.obs_names).values

    sc.pp.normalize_total(adata, target_sum=1e4)
    sc.pp.log1p(adata)

    model = celltypist.models.Model.load(sp.get("model", "Immune_All_Low.pkl"))
    pred = celltypist.annotate(adata, model=model, majority_voting=bool(sp.get("majority_voting", True)),
                               over_clustering="cluster")
    labels = pred.predicted_labels
    column = "majority_voting" if "majority_voting" in labels else "predicted_labels"
    labels["cluster"] = adata.obs["cluster"].values
    per_cluster = labels.groupby("cluster")[column].agg(lambda s: s.value_counts().index[0]).to_dict()
    confidence = pred.probability_matrix.max(axis=1).groupby(adata.obs["cluster"].values).mean().round(3).to_dict()

    (work / "results").mkdir(exist_ok=True)
    labels.to_csv(work / "results" / "celltypist_predictions.csv")
    (work / "results" / "celltypist_clusters.json").write_text(
        json.dumps({"labels": per_cluster, "confidence": confidence}, indent=2))

    params["annotations"] = per_cluster
    Path(params_path).write_text(json.dumps(params, indent=2))


if __name__ == "__main__":
    main(sys.argv[1])
