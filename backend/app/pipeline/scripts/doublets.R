# Stage 6 (scDblFinder): classify doublets per sample and keep singlets.
source(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(), value = TRUE))), "_common.R"))
suppressPackageStartupMessages({
  library(scDblFinder)
  library(SingleCellExperiment)
})

p <- load_params()
sp <- stage_params(p, "doublets")
obj <- readRDS(obj_path(p, "qc"))

sce <- SingleCellExperiment(assays = list(counts = LayerData(obj, assay = "RNA", layer = "counts")))
sce$sample <- obj$sample
args <- list(sce, samples = "sample", BPPARAM = BiocParallel::SerialParam(RNGseed = 1))
if (!is.null(sp$dbr)) args$dbr <- sp$dbr
sce <- do.call(scDblFinder, args)

obj$doublet_score <- sce$scDblFinder.score
obj$doublet_class <- sce$scDblFinder.class
rates <- tapply(obj$doublet_class == "doublet", obj$sample, mean)

obj <- subset(obj, subset = doublet_class == "singlet")
saveRDS(obj, obj_path(p, "singlets"))
write_json_result(list(doublet_rate = as.list(rates), singlets = as.list(table(obj$sample))),
                  p, "doublets.json")
