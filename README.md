# Lilac scRNA Studio

A web app for Lilac Biosciences that runs the standard single-cell RNA-seq pipeline, from raw BCL
files to UMAPs and differential expression between conditions, and shows every result along the way.

```
backend/    FastAPI (Python) – stage catalog, run orchestration, results API, R/Python stage scripts
frontend/   React + TypeScript (Vite) – the interface, in Lilac's palette
```

## The pipeline

| # | Stage | Standard tool | Alternatives in the catalog |
|---|-------|---------------|-----------------------------|
| 1 | Demultiplexing | BCL Convert | (skipped when starting from FASTQ) |
| 2 | Read QC | FastQC + MultiQC | FastQC only |
| 3 | Alignment and cell calling | STARsolo | kallisto \| bustools |
| 4 | Ambient RNA removal | SoupX | CellBender (calls cells itself) |
| 5 | Cell QC filtering | Seurat | Scanpy *(planned)* |
| 6 | Doublet removal | scDblFinder | – |
| 7 | Normalization | Seurat NormalizeData → FindVariableFeatures → ScaleData | SCTransform |
| 8 | Integration, clustering, UMAP | Seurat RunPCA → IntegrateLayers → FindNeighbors → FindClusters → RunUMAP → JoinLayers | Scanpy *(planned)* |
| 9 | Cell type annotation | Seurat markers (manual, pauses the run) | CellTypist (automatic) |
| 10 | Differential expression | AggregateExpression + DESeq2 (pseudobulk) | – |

The standard preset keeps stages 5–8 in Seurat so one object flows through. Scanpy options are listed
but marked *Planned*; the API rejects them until their scripts and the R↔Python hand-off exist.

`backend/app/pipeline/stages.py` is the single source of truth: the API serves it, the New Run screen
is rendered from it, and the runner validates against it. `commands.py` turns a run into argv lists
for each stage; `scripts/` holds the R and Python each stage runs (each reads `params.json`).

## Run it locally

**Backend** (Python 3.11+):

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000     # API docs at http://localhost:8000/docs
pytest                                         # 5 tests: catalog, full demo run, validation, STAR command
```

Demo mode is on by default (`LILAC_DEMO=1`): runs advance on a timer and serve synthetic PBMC results,
so the whole app works with no sequencing data or tools installed. `POST /api/runs/demo` creates one.

**Frontend** (Node 18+):

```bash
cd frontend
npm install
npm run dev                 # http://localhost:5173, talks to the API at VITE_API_URL
npm run build:preview       # single self-contained HTML running on built-in demo data
```

## Hosted demo

The root `Dockerfile` builds the frontend and runs FastAPI in demo mode, serving the site and the API
from one origin (no R or sequencing tools in the image). On start it seeds one finished run; runs
you create are simulated. Render, Fly.io or any Docker host works:

```bash
docker build -t lilac-studio . && docker run -p 8000:8000 lilac-studio
```

## Real (non-demo) runs

Set `LILAC_DEMO=0` and install the tools in `backend/requirements-pipeline.txt` plus:
bcl-convert, FastQC, STAR ≥ 2.7.11, and R ≥ 4.4 with Seurat 5, SoupX, scDblFinder, DESeq2, apeglm,
harmony, scCustomize, jsonlite, ggplot2. Put references under `LILAC_REFERENCE_ROOT`:

```
<root>/<reference>/star/            STAR index
<root>/<reference>/kallisto/        index.idx, t2g.txt
<root>/whitelists/                  10x barcode whitelists (3M-february-2018.txt, …)
```

Other settings: `LILAC_DATA_DIR` (runs, logs, outputs), `LILAC_RSCRIPT`, `LILAC_PYTHON`,
`LILAC_CORS_ORIGINS`.

## Before deploying (to discuss)

- **Job execution.** Runs execute on a background thread in the API process. For production, move
  stage execution to a queue (Celery/RQ) or hand the same commands to Nextflow/Snakemake on an HPC or
  cloud batch backend; alignment and CellBender need far more memory/GPU than a web server.
- **Storage.** Run state is JSON files on disk; swap `store.py` for Postgres, and outputs for object storage.
- **Accounts.** No authentication yet.
- **Real-mode results.** UMAP, markers and DE are read from the stage outputs; QC currently returns the
  raw JSON from MultiQC and the R scripts rather than the shaped tables demo mode serves.
- **Containers.** One image for the API, one (large) image with the R/Python/CLI toolchain.
