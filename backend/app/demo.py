"""Synthetic results for demo mode.

Generates a believable PBMC experiment (Control vs IFN-β stimulated, three donors each) so the
whole interface can be exercised without sequencing data or bioinformatics tools installed.
Everything is seeded, so the same run ID always produces the same results.
"""

from __future__ import annotations

import math
from typing import Any

import numpy as np

CELL_TYPES = [
    # label, share, UMAP centre, spread (sx, sy), markers
    ("CD4 T naive", 0.22, (-4.2, 2.6), (1.0, 0.75), ["IL7R", "CCR7", "LEF1", "TCF7", "SELL"]),
    ("CD14 Monocyte", 0.19, (5.0, -1.2), (1.1, 1.3), ["CD14", "LYZ", "S100A8", "S100A9", "VCAN"]),
    ("CD4 T memory", 0.15, (-2.2, 4.4), (0.9, 0.7), ["IL7R", "S100A4", "AQP3", "CD40LG", "IL32"]),
    ("B cell", 0.12, (-1.0, -5.0), (1.0, 0.8), ["MS4A1", "CD79A", "CD79B", "BANK1", "IGHM"]),
    ("CD8 T", 0.11, (-6.0, 0.4), (0.8, 1.0), ["CD8A", "CD8B", "GZMK", "CCL5", "LAG3"]),
    ("NK", 0.08, (-7.2, -2.4), (0.8, 0.8), ["GNLY", "NKG7", "GZMB", "PRF1", "KLRD1"]),
    ("FCGR3A Monocyte", 0.06, (7.4, 1.6), (0.7, 0.7), ["FCGR3A", "MS4A7", "CDKN1C", "LST1", "IFITM3"]),
    ("Dendritic", 0.04, (4.0, 3.4), (0.6, 0.55), ["FCER1A", "CST3", "CLEC10A", "CD1C", "HLA-DQA1"]),
    ("Platelet", 0.03, (1.4, 6.4), (0.35, 0.35), ["PPBP", "PF4", "GP9", "TUBB1", "CAVIN2"]),
]

FEATURE_GENES = ["IL7R", "CCR7", "CD8A", "GNLY", "NKG7", "MS4A1", "CD79A", "CD14", "LYZ", "FCGR3A",
                 "FCER1A", "PPBP", "ISG15", "IFI6"]

ISG_GENES = ["ISG15", "IFI6", "IFIT1", "IFIT3", "MX1", "OAS1", "IFI44L", "RSAD2", "IFITM1", "IFIT2",
             "LY6E", "XAF1", "STAT1", "IRF7", "OAS2", "MX2", "HERC5", "EPSTI1", "CMPK2", "SAMD9L",
             "PLSCR1", "BST2", "IFI35", "SP110", "PARP14", "DDX58", "IFIH1", "TNFSF10", "GBP1", "CXCL10"]
DOWN_GENES = ["CCR7", "SELL", "LEF1", "TXNIP", "KLF2", "FOS", "JUN", "DUSP1", "CD52", "TSC22D3",
              "ZFP36", "KLF6", "IER2", "PIK3IP1", "NOSIP"]
BACKGROUND_GENES = [
    "ACTB", "GAPDH", "B2M", "TMSB4X", "MALAT1", "EEF1A1", "RPL13", "RPS27", "FTL", "FTH1", "TPT1",
    "HLA-A", "HLA-B", "HLA-C", "HLA-E", "CD74", "PTPRC", "CD3E", "CD3D", "CD2", "CD247", "LCK", "ZAP70",
    "CD69", "CD44", "ITGB1", "ANXA1", "ANXA2", "VIM", "LGALS1", "S100A6", "S100A10", "S100A11", "MYL6",
    "ARHGDIB", "CORO1A", "LCP1", "CFL1", "PFN1", "SRGN", "LAPTM5", "CTSS", "CTSB", "PSAP", "TYROBP",
    "FCER1G", "AIF1", "COTL1", "NPC2", "GRN", "SAT1", "NEAT1", "PNRC1", "BTG1", "BTG2", "NFKBIA",
    "TNFAIP3", "CXCR4", "CD83", "CD86", "CD80", "HLA-DRA", "HLA-DRB1", "HLA-DPA1", "HLA-DPB1", "IRF8",
    "SPI1", "CEBPB", "CEBPD", "KLF4", "MAFB", "CSF1R", "ITGAX", "ITGAM", "CD68", "CD163", "MRC1",
    "SELPLG", "ICAM1", "ICAM3", "ITGAL", "ITGB2", "CD48", "CD53", "CD37", "CD27", "CD28", "ICOS",
    "CTLA4", "PDCD1", "TIGIT", "HAVCR2", "TOX", "EOMES", "TBX21", "GATA3", "RORC", "FOXP3", "IL2RA",
    "IL2RB", "IL7", "IL15", "IL18", "IL1B", "TNF", "IFNG", "CCL3", "CCL4", "CCL2", "CXCL8", "CCR2",
    "CX3CR1", "SPN", "PECAM1", "NCAM1", "KLRB1", "KLRF1", "KLRC1", "FCGR3B", "CD19", "CD22", "PAX5",
    "TCL1A", "FCRL5", "JCHAIN", "MZB1", "XBP1", "PRDM1", "SDC1", "CD38", "MKI67", "TOP2A", "PCNA",
    "MCM2", "TYMS", "STMN1", "HMGB2", "H2AZ1", "TUBA1B", "TUBB", "CALM1", "CALM2", "UBC", "UBB",
    "HSPA1A", "HSPA1B", "HSP90AA1", "DNAJB1", "SOD1", "SOD2", "PRDX1", "GPX1", "TXN", "NDUFA4",
    "COX7C", "ATP5F1E", "MT-CO1", "MT-CO2", "MT-ND1", "MT-ND4", "MT-CYB", "MT-ATP6", "RACK1", "NACA",
    "EIF1", "EIF4A1", "PABPC1", "HNRNPA1", "SRSF2", "SNRPD2", "LDHA", "PKM", "ENO1", "ALDOA", "PGK1",
]

SAMPLES = [
    {"id": "Donor1_Ctrl", "condition": "Control", "replicate": 1},
    {"id": "Donor2_Ctrl", "condition": "Control", "replicate": 2},
    {"id": "Donor3_Ctrl", "condition": "Control", "replicate": 3},
    {"id": "Donor1_IFNb", "condition": "IFN-β", "replicate": 1},
    {"id": "Donor2_IFNb", "condition": "IFN-β", "replicate": 2},
    {"id": "Donor3_IFNb", "condition": "IFN-β", "replicate": 3},
]


def _rng(seed: str) -> np.random.Generator:
    return np.random.default_rng(abs(hash_str(seed)) % (2**32))


def hash_str(s: str) -> int:
    h = 2166136261
    for ch in s.encode():
        h = ((h ^ ch) * 16777619) & 0xFFFFFFFF
    return h


def _round(values: np.ndarray, digits: int = 3) -> list[float]:
    return [round(float(v), digits) for v in values]


def gene_universe() -> list[str]:
    seen: dict[str, None] = {}
    for g in [*ISG_GENES, *DOWN_GENES, *(m for ct in CELL_TYPES for m in ct[4]), *BACKGROUND_GENES]:
        seen.setdefault(g, None)
    genes = list(seen)
    # Pad with lncRNA-style names so volcano plots have realistic density.
    i = 1
    while len(genes) < 1600:
        genes.append(f"LINC{1000 + i * 7:05d}" if i % 3 else f"ENSG00000{240000 + i * 13}")
        i += 1
    return genes


def read_qc(seed: str) -> list[dict[str, Any]]:
    rng = _rng(seed + "reads")
    out = []
    for s in SAMPLES:
        reads = int(rng.normal(310e6, 30e6))
        q30 = float(rng.normal(92.5, 1.2))
        adapter = float(abs(rng.normal(1.2, 0.5)))
        dup = float(rng.normal(58, 4))
        out.append({
            "sample": s["id"],
            "total_reads": reads,
            "q30": round(q30, 1),
            "mean_quality": round(float(rng.normal(35.6, 0.4)), 1),
            "gc": round(float(rng.normal(46, 1.2)), 1),
            "adapter": round(adapter, 2),
            "duplication": round(dup, 1),
            "status": "warn" if q30 < 91 or adapter > 2.5 else "pass",
        })
    return out


def alignment(seed: str) -> list[dict[str, Any]]:
    rng = _rng(seed + "align")
    out = []
    for s in SAMPLES:
        cells = int(rng.normal(7200, 600))
        out.append({
            "sample": s["id"],
            "mapped": round(float(rng.normal(91.5, 1.5)), 1),
            "unique": round(float(rng.normal(84.0, 2.0)), 1),
            "cells_called": cells,
            "median_umi": int(rng.normal(6100, 500)),
            "median_genes": int(rng.normal(2050, 150)),
            "saturation": round(float(rng.normal(62, 4)), 1),
            "contamination": round(float(abs(rng.normal(0.06, 0.025))), 3),
        })
    return out


def _density(values: np.ndarray, lo: float, hi: float, bins: int = 48) -> dict[str, Any]:
    hist, edges = np.histogram(values, bins=bins, range=(lo, hi), density=True)
    hist = np.convolve(hist, np.ones(3) / 3, mode="same")
    peak = hist.max() or 1
    return {"lo": lo, "hi": hi, "density": _round(hist / peak, 3),
            "median": round(float(np.median(values)), 2)}


def cell_qc(seed: str, align: list[dict[str, Any]]) -> dict[str, Any]:
    rng = _rng(seed + "cellqc")
    per_sample = []
    funnel_called = funnel_qc = funnel_singlets = 0
    for s, a in zip(SAMPLES, align):
        n = a["cells_called"]
        genes = np.concatenate([rng.lognormal(math.log(2100), 0.38, int(n * 0.92)),
                                rng.lognormal(math.log(320), 0.5, n - int(n * 0.92))])
        umis = genes * rng.lognormal(math.log(2.9), 0.25, n)
        mt = np.concatenate([np.abs(rng.normal(4.5, 2.2, int(n * 0.9))),
                             np.abs(rng.normal(22, 9, n - int(n * 0.9)))])
        keep = (genes >= 200) & (genes <= 6000) & (mt <= 15)
        n_qc = int(keep.sum())
        dbl_rate = round(float(rng.normal(0.058, 0.01)), 3)
        n_single = int(n_qc * (1 - dbl_rate))
        funnel_called += n
        funnel_qc += n_qc
        funnel_singlets += n_single
        per_sample.append({
            "sample": s["id"],
            "n_genes": _density(np.log10(genes), 1.8, 4.0),
            "n_umi": _density(np.log10(umis), 2.2, 5.0),
            "percent_mt": _density(mt, 0, 50),
            "cells_before": n,
            "cells_after_qc": n_qc,
            "doublet_rate": dbl_rate,
            "singlets": n_single,
        })
    return {
        "thresholds": {"min_features": 200, "max_features": 6000, "max_percent_mt": 15},
        "samples": per_sample,
        "funnel": [
            {"step": "Cells called", "cells": funnel_called},
            {"step": "Passed cell QC", "cells": funnel_qc},
            {"step": "Singlets", "cells": funnel_singlets},
        ],
    }


def umap(seed: str, n_points: int = 6000) -> dict[str, Any]:
    rng = _rng(seed + "umap")
    shares = np.array([c[1] for c in CELL_TYPES])
    xs, ys, clusters, samples = [], [], [], []
    for si, s in enumerate(SAMPLES):
        stim = s["condition"] != "Control"
        w = shares.copy()
        if stim:
            w[1] *= 1.25  # monocytes expand after stimulation
            w[0] *= 0.85
        w = w / w.sum()
        counts = rng.multinomial(n_points // len(SAMPLES), w)
        for ci, k in enumerate(counts):
            _, _, (cx, cy), (sx, sy), _ = CELL_TYPES[ci]
            t = rng.normal(0, 1, k)
            # Curve each cluster slightly so it reads as a manifold, not a blob.
            x = cx + sx * t + rng.normal(0, 0.25, k)
            y = cy + sy * rng.normal(0, 1, k) + 0.12 * t**2
            if stim:  # stimulated cells sit on one flank of each cluster
                x += 0.35 * sx
                y -= 0.15 * sy
            xs.append(x); ys.append(y)
            clusters.append(np.full(k, ci)); samples.append(np.full(k, si))
    x = np.concatenate(xs); y = np.concatenate(ys)
    cl = np.concatenate(clusters); sm = np.concatenate(samples)
    order = rng.permutation(len(x))
    x, y, cl, sm = x[order], y[order], cl[order], sm[order]

    # Expression for feature plots, quantized to 0–100 (log-normalized ×25).
    features: dict[str, list[int]] = {}
    for gene in FEATURE_GENES:
        expr = rng.gamma(0.6, 0.35, len(x))
        for ci, ct in enumerate(CELL_TYPES):
            if gene in ct[4]:
                mask = cl == ci
                expr[mask] = rng.normal(2.6, 0.6, mask.sum()) * (rng.random(mask.sum()) < 0.88)
        if gene in ISG_GENES:
            stim_mask = np.isin(sm, [3, 4, 5])
            expr[stim_mask] += rng.normal(2.2, 0.5, stim_mask.sum())
        expr = np.clip(expr, 0, 4)
        features[gene] = [int(v * 25) for v in expr]

    cluster_info = []
    for ci, ct in enumerate(CELL_TYPES):
        mask = cl == ci
        cluster_info.append({
            "id": str(ci),
            "n": int(mask.sum()),
            "suggested_label": ct[0],
            "confidence": round(float(rng.uniform(0.82, 0.98)), 2),
            "centroid": [round(float(x[mask].mean()), 2), round(float(y[mask].mean()), 2)],
            "top_markers": ct[4][:4],
        })
    return {
        "x": _round(x, 2), "y": _round(y, 2),
        "cluster": cl.astype(int).tolist(), "sample": sm.astype(int).tolist(),
        "samples": SAMPLES,
        "clusters": cluster_info,
        "features": features,
    }


def markers(seed: str) -> dict[str, Any]:
    """Dot-plot data: average expression and percent expressing, clusters × marker genes."""
    rng = _rng(seed + "markers")
    genes = list(dict.fromkeys(m for ct in CELL_TYPES for m in ct[4][:3]))[:20]
    rows = []
    for ci, ct in enumerate(CELL_TYPES):
        for g in genes:
            own = g in ct[4]
            rows.append({
                "cluster": str(ci), "gene": g,
                "avg": round(float(rng.normal(2.4, 0.3) if own else abs(rng.normal(0.15, 0.15))), 2),
                "pct": round(float(rng.uniform(70, 96) if own else rng.uniform(1, 18)), 1),
            })
    table = []
    for ci, ct in enumerate(CELL_TYPES):
        for rank, g in enumerate(ct[4]):
            table.append({
                "cluster": str(ci), "gene": g,
                "avg_log2fc": round(float(rng.normal(3.1 - rank * 0.35, 0.3)), 2),
                "pct_1": round(float(rng.uniform(0.7, 0.97)), 2),
                "pct_2": round(float(rng.uniform(0.02, 0.2)), 2),
                "p_val_adj": float(f"{10 ** -rng.uniform(80, 300):.2e}"),
            })
    return {"genes": genes, "dots": rows, "table": table}


def _bh(p: np.ndarray) -> np.ndarray:
    n = len(p)
    order = np.argsort(p)
    ranked = p[order] * n / (np.arange(n) + 1)
    ranked = np.minimum.accumulate(ranked[::-1])[::-1]
    out = np.empty(n)
    out[order] = np.clip(ranked, 0, 1)
    return out


def de(seed: str, cell_type: str) -> dict[str, Any]:
    rng = _rng(seed + "de" + cell_type)
    genes = gene_universe()
    n = len(genes)
    strength = {"CD14 Monocyte": 1.25, "FCGR3A Monocyte": 1.15, "Dendritic": 1.0, "B cell": 0.95}.get(cell_type, 0.85)
    lfc = rng.normal(0, 0.22, n)
    se = rng.uniform(0.12, 0.55, n)
    base = rng.lognormal(4.5, 1.6, n)
    for i, g in enumerate(genes):
        if g in ISG_GENES:
            lfc[i] = rng.normal(3.2, 1.1) * strength
            se[i] = rng.uniform(0.15, 0.35)
            base[i] = rng.lognormal(6, 1)
        elif g in DOWN_GENES:
            lfc[i] = -abs(rng.normal(1.3, 0.5)) * strength
            se[i] = rng.uniform(0.2, 0.4)
    # A few cell-type-specific responders.
    for i in rng.choice(np.arange(len(ISG_GENES) + len(DOWN_GENES), n), 18, replace=False):
        lfc[i] = rng.choice([-1, 1]) * rng.uniform(0.8, 2.0)
        se[i] = rng.uniform(0.2, 0.4)
    z = np.abs(lfc / se)
    p = np.clip(np.exp(-0.717 * z - 0.416 * z**2), 1e-300, 1)
    padj = _bh(p)
    rows = sorted(
        ({"gene": g, "log2fc": round(float(l), 3), "pvalue": float(f"{pv:.3e}"), "padj": float(f"{pa:.3e}"),
          "base_mean": round(float(b), 1)}
         for g, l, pv, pa, b in zip(genes, lfc, p, padj, base)),
        key=lambda r: r["padj"],
    )

    # Heatmap: z-scored normalized counts of the top 24 genes across pseudobulk samples.
    top = rows[:24]
    heat = []
    for r in top:
        vals = np.array([(0.85 if s["condition"] != "Control" else -0.85) * np.sign(r["log2fc"])
                         + rng.normal(0, 0.28) for s in SAMPLES])
        vals = (vals - vals.mean()) / (vals.std() or 1)
        heat.append({"gene": r["gene"], "values": _round(vals, 2)})
    return {
        "cell_type": cell_type,
        "contrast": {"factor": "condition", "test": "IFN-β", "reference": "Control"},
        "n_pseudobulk": {"Control": 3, "IFN-β": 3},
        "genes": rows,
        "heatmap": {"samples": [s["id"] for s in SAMPLES], "rows": heat},
    }


def de_summary(seed: str, padj: float = 0.05, lfc: float = 0.5) -> list[dict[str, Any]]:
    out = []
    for ct in CELL_TYPES:
        res = de(seed, ct[0])
        up = sum(1 for g in res["genes"] if g["padj"] < padj and g["log2fc"] >= lfc)
        down = sum(1 for g in res["genes"] if g["padj"] < padj and g["log2fc"] <= -lfc)
        out.append({"cell_type": ct[0], "up": up, "down": down, "tested": len(res["genes"])})
    return out


def all_results(seed: str) -> dict[str, Any]:
    align = alignment(seed)
    return {
        "read_qc": read_qc(seed),
        "alignment": align,
        "cell_qc": cell_qc(seed, align),
        "umap": umap(seed),
        "markers": markers(seed),
        "de_summary": de_summary(seed),
        "de": {ct[0]: de(seed, ct[0]) for ct in CELL_TYPES},
    }
