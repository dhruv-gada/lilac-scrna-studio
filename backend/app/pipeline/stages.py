"""Catalog of the ten pipeline stages, the tools each one can run, and their parameters.

This module is the single source of truth for what the pipeline can do. The API serves it
to the frontend, which renders the configuration screen from it, and the runner uses it to
validate a run before anything executes.

The "standard" preset uses Seurat wherever Seurat offers the step, so a run never mixes
R and Python objects unless the person chooses a custom tool.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ParamType = Literal["int", "float", "bool", "str", "choice", "path"]


class Param(BaseModel):
    key: str
    label: str
    type: ParamType
    default: Any = None
    help: str = ""
    choices: list[str] | None = None
    min: float | None = None
    max: float | None = None
    step: float | None = None
    unit: str | None = None


class Tool(BaseModel):
    id: str
    label: str
    language: Literal["cli", "R", "python"]
    summary: str
    params: list[Param] = Field(default_factory=list)
    calls_cells: bool = False
    """True when the tool decides which barcodes are cells (STARsolo, kallisto, CellBender)."""
    available: bool = True
    """False for tools that are listed in the catalog but not wired into the runner yet."""


class Stage(BaseModel):
    id: str
    order: int
    name: str
    goal: str
    inputs: list[str]
    outputs: list[str]
    tools: list[Tool]
    default_tool: str
    optional: bool = False
    """Optional stages can be skipped, e.g. demultiplexing when you start from FASTQ files."""


STAGES: list[Stage] = [
    Stage(
        id="demux",
        order=1,
        name="Demultiplexing",
        goal="Convert raw BCL base calls into per-sample FASTQ files.",
        inputs=["BCL run folder", "Sample sheet"],
        outputs=["Demultiplexed FASTQ files"],
        default_tool="bcl-convert",
        optional=True,
        tools=[
            Tool(
                id="bcl-convert",
                label="BCL Convert",
                language="cli",
                summary="Illumina's demultiplexer. Splits reads by index into one FASTQ set per sample.",
                params=[
                    Param(key="no_lane_splitting", label="Merge lanes", type="bool", default=True,
                          help="Write one FASTQ per read instead of one per lane."),
                    Param(key="threads", label="Threads", type="int", default=16, min=1, max=128),
                ],
            )
        ],
    ),
    Stage(
        id="read_qc",
        order=2,
        name="Read quality control",
        goal="Check base quality, adapter content and duplication before alignment.",
        inputs=["FASTQ files"],
        outputs=["Per-file FastQC reports", "Aggregated MultiQC report"],
        default_tool="fastqc_multiqc",
        tools=[
            Tool(id="fastqc_multiqc", label="FastQC + MultiQC", language="cli",
                 summary="FastQC on every file, then MultiQC rolls the reports into one page.",
                 params=[Param(key="threads", label="Threads", type="int", default=8, min=1, max=64)]),
            Tool(id="fastqc", label="FastQC only", language="cli",
                 summary="One report per FASTQ file, no aggregate view.",
                 params=[Param(key="threads", label="Threads", type="int", default=8, min=1, max=64)]),
        ],
    ),
    Stage(
        id="align",
        order=3,
        name="Alignment and cell calling",
        goal="Map reads to the reference and build a gene-by-cell count matrix.",
        inputs=["FASTQ files", "Reference genome or index"],
        outputs=["Raw and filtered gene-by-cell matrices", "Cell calls"],
        default_tool="starsolo",
        tools=[
            Tool(
                id="starsolo",
                label="STARsolo",
                language="cli",
                calls_cells=True,
                summary="Splice-aware alignment with Cell Ranger–compatible barcode and UMI handling.",
                params=[
                    Param(key="chemistry", label="Chemistry", type="choice", default="10x v3",
                          choices=["10x v2", "10x v3", "10x v4"]),
                    Param(key="cell_filter", label="Cell calling", type="choice", default="EmptyDrops_CR",
                          choices=["EmptyDrops_CR", "CellRanger2.2", "None"]),
                    Param(key="threads", label="Threads", type="int", default=16, min=1, max=128),
                ],
            ),
            Tool(
                id="kallisto",
                label="kallisto | bustools",
                language="cli",
                calls_cells=True,
                summary="Alignment-free pseudoalignment. Faster and lighter, but no mapped reads (BAM).",
                params=[
                    Param(key="chemistry", label="Chemistry", type="choice", default="10x v3",
                          choices=["10x v2", "10x v3", "10x v4"]),
                    Param(key="threads", label="Threads", type="int", default=16, min=1, max=128),
                ],
            ),
        ],
    ),
    Stage(
        id="ambient",
        order=4,
        name="Ambient RNA removal",
        goal="Remove background transcripts from lysed cells that leak into every droplet.",
        inputs=["Raw count matrix", "Cell calls"],
        outputs=["Cleaned count matrix"],
        default_tool="soupx",
        tools=[
            Tool(id="soupx", label="SoupX", language="R",
                 summary="Estimates contamination per sample and subtracts it. Uses STARsolo's cell calls.",
                 params=[
                     Param(key="auto_estimate", label="Estimate contamination automatically", type="bool",
                           default=True),
                     Param(key="contamination", label="Contamination fraction", type="float", default=0.1,
                           min=0.0, max=0.5, step=0.01,
                           help="Used only when automatic estimation is off."),
                 ]),
            Tool(id="cellbender", label="CellBender", language="python", calls_cells=True,
                 summary="Deep generative model that removes ambient RNA and calls cells itself. GPU recommended.",
                 params=[
                     Param(key="expected_cells", label="Expected cells per sample", type="int", default=5000,
                           min=100),
                     Param(key="total_droplets", label="Droplets to include", type="int", default=20000, min=1000),
                     Param(key="fpr", label="False positive rate", type="float", default=0.01, min=0.0, max=0.3,
                           step=0.01),
                     Param(key="use_gpu", label="Use GPU", type="bool", default=True),
                 ]),
        ],
    ),
    Stage(
        id="cell_qc",
        order=5,
        name="Cell quality filtering",
        goal="Drop low-quality cells: empty, dying or damaged barcodes.",
        inputs=["Gene-by-cell matrix"],
        outputs=["Quality-filtered matrix", "QC metrics per cell"],
        default_tool="seurat",
        tools=[
            Tool(id="seurat", label="Seurat", language="R",
                 summary="Filters on genes per cell, UMIs per cell and mitochondrial fraction.",
                 params=[
                     Param(key="min_features", label="Minimum genes per cell", type="int", default=200, min=0),
                     Param(key="max_features", label="Maximum genes per cell", type="int", default=6000, min=0),
                     Param(key="max_percent_mt", label="Maximum mitochondrial reads", type="float", default=15,
                           min=0, max=100, step=0.5, unit="%"),
                     Param(key="min_cells", label="Keep genes seen in at least", type="int", default=3, min=0,
                           unit="cells"),
                 ]),
            Tool(id="scanpy", label="Scanpy", language="python",
                 summary="The same filters in Python, with an AnnData hand-off back to Seurat.",
                 available=False,
                 params=[
                     Param(key="min_features", label="Minimum genes per cell", type="int", default=200, min=0),
                     Param(key="max_features", label="Maximum genes per cell", type="int", default=6000, min=0),
                     Param(key="max_percent_mt", label="Maximum mitochondrial reads", type="float", default=15,
                           min=0, max=100, step=0.5, unit="%"),
                     Param(key="min_cells", label="Keep genes seen in at least", type="int", default=3, min=0,
                           unit="cells"),
                 ]),
        ],
    ),
    Stage(
        id="doublets",
        order=6,
        name="Doublet removal",
        goal="Remove droplets that captured two cells.",
        inputs=["Quality-filtered matrix"],
        outputs=["Singlet-only matrix", "Doublet scores"],
        default_tool="scdblfinder",
        tools=[
            Tool(id="scdblfinder", label="scDblFinder", language="R",
                 summary="Simulates artificial doublets per sample and classifies each droplet.",
                 params=[
                     Param(key="dbr", label="Expected doublet rate", type="float", default=None, min=0, max=0.3,
                           step=0.005,
                           help="Leave empty to use scDblFinder's estimate from cells loaded (≈1% per 1,000)."),
                 ])
        ],
    ),
    Stage(
        id="normalize",
        order=7,
        name="Normalization",
        goal="Correct for sequencing depth per cell and pick highly variable genes.",
        inputs=["Filtered cell-by-gene counts"],
        outputs=["Normalized data", "Highly variable genes", "Scaled data"],
        default_tool="seurat",
        tools=[
            Tool(id="seurat", label="Seurat", language="R",
                 summary="NormalizeData → FindVariableFeatures → ScaleData, per sample layer.",
                 params=[
                     Param(key="method", label="Normalization", type="choice", default="LogNormalize",
                           choices=["LogNormalize", "SCTransform"]),
                     Param(key="scale_factor", label="Scale factor", type="int", default=10000, min=1),
                     Param(key="n_hvg", label="Variable genes", type="int", default=2000, min=200, max=10000),
                 ])
        ],
    ),
    Stage(
        id="cluster",
        order=8,
        name="Integration, clustering and UMAP",
        goal="Build the neighbor graph, find clusters and lay out a publication-ready UMAP.",
        inputs=["Normalized data"],
        outputs=["Clusters", "UMAP embedding", "Cluster markers"],
        default_tool="seurat",
        tools=[
            Tool(id="seurat", label="Seurat", language="R",
                 summary="RunPCA → IntegrateLayers → FindNeighbors → FindClusters → RunUMAP → JoinLayers.",
                 params=[
                     Param(key="n_pcs", label="Principal components", type="int", default=30, min=5, max=100),
                     Param(key="integration", label="Integration", type="choice", default="CCA",
                           choices=["CCA", "RPCA", "Harmony", "None"]),
                     Param(key="resolution", label="Cluster resolution", type="float", default=0.5, min=0.05,
                           max=3, step=0.05),
                     Param(key="min_dist", label="UMAP min. distance", type="float", default=0.3, min=0.01,
                           max=1, step=0.01),
                 ]),
            Tool(id="scanpy", label="Scanpy", language="python",
                 summary="PCA → Harmony → neighbors → Leiden → UMAP in Python.",
                 available=False,
                 params=[
                     Param(key="n_pcs", label="Principal components", type="int", default=30, min=5, max=100),
                     Param(key="resolution", label="Leiden resolution", type="float", default=0.5, min=0.05, max=3,
                           step=0.05),
                     Param(key="min_dist", label="UMAP min. distance", type="float", default=0.3, min=0.01,
                           max=1, step=0.01),
                 ]),
        ],
    ),
    Stage(
        id="annotate",
        order=9,
        name="Cell type annotation",
        goal="Give every cluster a biological identity.",
        inputs=["Clusters", "Expression"],
        outputs=["Cell type labels"],
        default_tool="seurat_markers",
        tools=[
            Tool(id="seurat_markers", label="Seurat markers (manual)", language="R",
                 summary="FeaturePlot of canonical markers on the UMAP; you assign labels per cluster.",
                 params=[
                     Param(key="markers", label="Marker genes", type="str",
                           default="IL7R, CCR7, CD8A, GNLY, NKG7, MS4A1, CD79A, CD14, LYZ, FCGR3A, FCER1A, PPBP",
                           help="Comma-separated genes to plot."),
                 ]),
            Tool(id="celltypist", label="CellTypist (automatic)", language="python",
                 summary="Logistic-regression classifier trained on reference atlases, with majority voting.",
                 params=[
                     Param(key="model", label="Model", type="choice", default="Immune_All_Low.pkl",
                           choices=["Immune_All_Low.pkl", "Immune_All_High.pkl", "Healthy_COVID19_PBMC.pkl",
                                    "Human_Lung_Atlas.pkl", "Mouse_Whole_Brain.pkl"]),
                     Param(key="majority_voting", label="Majority voting over clusters", type="bool", default=True),
                 ]),
        ],
    ),
    Stage(
        id="de",
        order=10,
        name="Differential expression",
        goal="Compare conditions within each cell type using pseudobulk replicates.",
        inputs=["Raw counts per cell type and sample", "Sample metadata"],
        outputs=["DE tables (log2 fold change, adjusted p-value)", "Volcano plots", "Heatmaps"],
        default_tool="deseq2",
        tools=[
            Tool(id="deseq2", label="AggregateExpression + DESeq2", language="R",
                 summary="Sums raw counts per cell type and sample, then tests condition with DESeq2.",
                 params=[
                     Param(key="reference", label="Reference condition", type="str", default="Control"),
                     Param(key="min_cells", label="Minimum cells per pseudobulk sample", type="int", default=10,
                           min=1),
                     Param(key="padj", label="Adjusted p-value cutoff", type="float", default=0.05, min=0.0001,
                           max=0.2, step=0.005),
                     Param(key="lfc", label="Log2 fold change cutoff", type="float", default=0.5, min=0, max=5,
                           step=0.05),
                     Param(key="shrink", label="Shrink fold changes (apeglm)", type="bool", default=True),
                 ])
        ],
    ),
]

STAGE_BY_ID: dict[str, Stage] = {s.id: s for s in STAGES}


def standard_preset() -> dict[str, dict[str, Any]]:
    """The default configuration: each stage's default tool with its default parameters."""
    preset: dict[str, dict[str, Any]] = {}
    for stage in STAGES:
        tool = next(t for t in stage.tools if t.id == stage.default_tool)
        preset[stage.id] = {
            "tool": tool.id,
            "enabled": True,
            "params": {p.key: p.default for p in tool.params},
        }
    return preset


def compatibility_notes(config: dict[str, dict[str, Any]]) -> list[dict[str, str]]:
    """Warnings and errors about tool combinations, shown before a run starts."""
    notes: list[dict[str, str]] = []
    tool = {sid: c.get("tool") for sid, c in config.items() if c.get("enabled", True)}

    if tool.get("ambient") == "cellbender" and tool.get("align") in ("starsolo", "kallisto"):
        notes.append({
            "level": "info",
            "stage": "ambient",
            "message": "CellBender calls cells itself, so it replaces the cell calls from alignment. "
                       "Alignment still provides the raw matrix.",
        })
    languages = {
        STAGE_BY_ID[sid].tools[[t.id for t in STAGE_BY_ID[sid].tools].index(tid)].language
        for sid, tid in tool.items()
        if sid in ("cell_qc", "normalize", "cluster") and tid
    }
    if {"R", "python"} <= languages:
        notes.append({
            "level": "warning",
            "stage": "cluster",
            "message": "This run mixes Seurat and Scanpy. Objects are converted between R and Python at "
                       "each hand-off, which adds time and can drop metadata. The standard preset keeps "
                       "everything in Seurat.",
        })
    if tool.get("annotate") == "seurat_markers":
        notes.append({
            "level": "info",
            "stage": "annotate",
            "message": "Manual annotation pauses the run after clustering so you can name clusters "
                       "before differential expression.",
        })
    return notes
