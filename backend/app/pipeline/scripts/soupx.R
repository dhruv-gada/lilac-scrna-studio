# Stage 4 (SoupX): estimate and subtract ambient RNA per sample.
# Needs the raw (all droplets) and filtered (called cells) matrices from alignment.
source(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(), value = TRUE))), "_common.R"))
suppressPackageStartupMessages(library(SoupX))

p <- load_params()
sp <- stage_params(p, "ambient")
summary <- list()

for (s in p$samples$id) {
  message("SoupX: ", s)
  raw <- read_counts(p, s, "raw")
  filt <- read_counts(p, s, "filtered")
  genes <- intersect(rownames(raw), rownames(filt))
  sc <- SoupChannel(raw[genes, ], filt[genes, ])

  # SoupX's automatic estimate needs clusters; a quick Seurat pass provides them.
  quick <- CreateSeuratObject(filt[genes, ]) |>
    NormalizeData(verbose = FALSE) |>
    FindVariableFeatures(verbose = FALSE) |>
    ScaleData(verbose = FALSE) |>
    RunPCA(npcs = 20, verbose = FALSE) |>
    FindNeighbors(dims = 1:20, verbose = FALSE) |>
    FindClusters(resolution = 0.5, verbose = FALSE)
  sc <- setClusters(sc, setNames(as.character(quick$seurat_clusters), colnames(quick)))

  if (isTRUE(sp$auto_estimate)) {
    sc <- autoEstCont(sc, doPlot = FALSE)
  } else {
    sc <- setContaminationFraction(sc, sp$contamination)
  }
  cleaned <- adjustCounts(sc, roundToInt = TRUE)
  saveRDS(cleaned, obj_path(p, paste0("soupx_", s)))
  summary[[s]] <- list(contamination = unname(sc$metaData$rho[1]), cells = ncol(cleaned))
}

write_json_result(summary, p, "ambient.json")
