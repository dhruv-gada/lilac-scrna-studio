"""Turns a run's configuration into the shell commands each stage executes.

Every builder returns a list of argv lists (no shell strings), run in order from the run's
work directory. Paths follow one layout so stages can find each other's outputs:

    <work>/fastq/              demultiplexed FASTQ files
    <work>/qc/fastqc, qc/multiqc
    <work>/align/<sample>/     STARsolo or kallisto output per sample
    <work>/ambient/<sample>/   CellBender output (SoupX writes into objects/)
    <work>/objects/            Seurat .rds objects handed from stage to stage
    <work>/results/            tables and figures shown in the app
    <work>/params.json         the run configuration, read by the R and Python scripts
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from ..config import settings
from ..models import Run

SCRIPTS = Path(__file__).parent / "scripts"

# 10x barcode/UMI geometry for STARsolo. Whitelists ship with Cell Ranger and live under the
# reference root as whitelists/<name>.txt.
CHEMISTRY = {
    "10x v2": {"cb_len": 16, "umi_start": 17, "umi_len": 10, "whitelist": "737K-august-2016.txt", "kb": "10xv2"},
    "10x v3": {"cb_len": 16, "umi_start": 17, "umi_len": 12, "whitelist": "3M-february-2018.txt", "kb": "10xv3"},
    "10x v4": {"cb_len": 16, "umi_start": 17, "umi_len": 12, "whitelist": "3M-3pgex-may-2023.txt", "kb": "10xv4"},
}


def _cfg(run: Run, stage: str) -> tuple[str, dict[str, Any]]:
    c = run.config[stage]
    return c.tool, c.params


def fastq_pairs(fastq_dir: Path, sample: str) -> tuple[list[Path], list[Path]]:
    """R1 (barcode + UMI) and R2 (cDNA) files for one sample, in lane order."""
    r1 = sorted(fastq_dir.glob(f"{sample}_S*_R1_001.fastq.gz")) or sorted(fastq_dir.glob(f"{sample}*R1*.fastq.gz"))
    r2 = sorted(fastq_dir.glob(f"{sample}_S*_R2_001.fastq.gz")) or sorted(fastq_dir.glob(f"{sample}*R2*.fastq.gz"))
    return r1, r2


def demux(run: Run, work: Path) -> list[list[str]]:
    _, p = _cfg(run, "demux")
    cmd = [
        "bcl-convert",
        "--bcl-input-directory", run.input_path,
        "--output-directory", str(work / "fastq"),
        "--sample-sheet", run.sample_sheet or str(Path(run.input_path) / "SampleSheet.csv"),
        "--bcl-num-conversion-threads", str(p.get("threads", 16)),
        "--force",
    ]
    if p.get("no_lane_splitting", True):
        cmd += ["--no-lane-splitting", "true"]
    return [cmd]


def read_qc(run: Run, work: Path, fastq_dir: Path) -> list[list[str]]:
    tool, p = _cfg(run, "read_qc")
    out = work / "qc" / "fastqc"
    fastqs = sorted(str(f) for f in fastq_dir.glob("*.fastq.gz"))
    cmds = [["mkdir", "-p", str(out)], ["fastqc", "--threads", str(p.get("threads", 8)), "--outdir", str(out), *fastqs]]
    if tool == "fastqc_multiqc":
        cmds.append(["multiqc", str(out), "--outdir", str(work / "qc" / "multiqc"), "--force",
                     "--data-format", "json"])
    return cmds


def align(run: Run, work: Path, fastq_dir: Path) -> list[list[str]]:
    tool, p = _cfg(run, "align")
    chem = CHEMISTRY[p.get("chemistry", "10x v3")]
    ref = settings.reference_root / run.reference
    threads = str(p.get("threads", 16))
    cmds: list[list[str]] = []
    for s in run.samples:
        r1, r2 = fastq_pairs(fastq_dir, s.id)
        out = work / "align" / s.id
        cmds.append(["mkdir", "-p", str(out)])
        if tool == "starsolo":
            cmds.append([
                "STAR", "--runMode", "alignReads", "--runThreadN", threads,
                "--genomeDir", str(ref / "star"),
                # STARsolo takes the cDNA read first, then the barcode read.
                "--readFilesIn", ",".join(map(str, r2)), ",".join(map(str, r1)),
                "--readFilesCommand", "zcat",
                "--soloType", "CB_UMI_Simple",
                "--soloCBwhitelist", str(settings.reference_root / "whitelists" / chem["whitelist"]),
                "--soloCBlen", str(chem["cb_len"]), "--soloUMIstart", str(chem["umi_start"]),
                "--soloUMIlen", str(chem["umi_len"]),
                # Match Cell Ranger's counting so results are comparable.
                "--clipAdapterType", "CellRanger4", "--outFilterScoreMin", "30",
                "--soloCBmatchWLtype", "1MM_multi_Nbase_pseudocounts",
                "--soloUMIfiltering", "MultiGeneUMI_CR", "--soloUMIdedup", "1MM_CR",
                "--soloFeatures", "Gene", "GeneFull",
                "--soloCellFilter", p.get("cell_filter", "EmptyDrops_CR"),
                "--outSAMtype", "BAM", "SortedByCoordinate",
                "--outSAMattributes", "NH", "HI", "nM", "AS", "CR", "UR", "CB", "UB", "GX", "GN", "sS", "sQ", "sM",
                "--outFileNamePrefix", f"{out}/",
            ])
        else:
            fq = [str(f) for pair in zip(r1, r2) for f in pair]
            cmds.append([
                "kb", "count", "-i", str(ref / "kallisto" / "index.idx"), "-g", str(ref / "kallisto" / "t2g.txt"),
                "-x", chem["kb"], "-o", str(out), "-t", threads, "--filter", "bustools", *fq,
            ])
    return cmds


def ambient(run: Run, work: Path) -> list[list[str]]:
    tool, p = _cfg(run, "ambient")
    params = str(work / "params.json")
    if tool == "soupx":
        return [[settings.rscript, str(SCRIPTS / "soupx.R"), params]]
    cmds: list[list[str]] = []
    for s in run.samples:
        out = work / "ambient" / s.id
        raw = (work / "align" / s.id / "Solo.out" / "Gene" / "raw"
               if run.config["align"].tool == "starsolo" else work / "align" / s.id / "counts_unfiltered")
        cmd = ["cellbender", "remove-background", "--input", str(raw), "--output", str(out / "cellbender.h5"),
               "--expected-cells", str(p.get("expected_cells", 5000)),
               "--total-droplets-included", str(p.get("total_droplets", 20000)),
               "--fpr", str(p.get("fpr", 0.01))]
        if p.get("use_gpu", True):
            cmd.append("--cuda")
        cmds += [["mkdir", "-p", str(out)], cmd]
    return cmds


def r_or_py(run: Run, work: Path, stage: str) -> list[list[str]]:
    """Stages 5–10 run one script each; the script reads params.json for its settings."""
    tool, _ = _cfg(run, stage)
    script = {
        ("cell_qc", "seurat"): "cell_qc.R",
        ("doublets", "scdblfinder"): "doublets.R",
        ("normalize", "seurat"): "normalize.R",
        ("cluster", "seurat"): "cluster.R",
        ("annotate", "seurat_markers"): "annotate_markers.R",
        ("de", "deseq2"): "de_pseudobulk.R",
    }.get((stage, tool))
    if script is None:
        raise ValueError(f"{tool} is not available for {stage} yet")
    runner = settings.rscript if script.endswith(".R") else settings.python
    return [[runner, str(SCRIPTS / script), str(work / "params.json")]]


def build(run: Run, stage: str, work: Path) -> list[list[str]]:
    fastq_dir = work / "fastq" if run.input_type == "bcl" else Path(run.input_path)
    if stage == "demux":
        return demux(run, work)
    if stage == "read_qc":
        return read_qc(run, work, fastq_dir)
    if stage == "align":
        return align(run, work, fastq_dir)
    if stage == "ambient":
        return ambient(run, work)
    if stage == "annotate" and run.config["annotate"].tool == "celltypist":
        params = str(work / "params.json")
        return [
            [settings.rscript, str(SCRIPTS / "export_counts.R"), params],
            [settings.python, str(SCRIPTS / "annotate_celltypist.py"), params],
            [settings.rscript, str(SCRIPTS / "annotate_markers.R"), params],
        ]
    return r_or_py(run, work, stage)
