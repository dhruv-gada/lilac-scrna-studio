# Stage 5 (Seurat): per-cell QC metrics and filtering.
source(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(), value = TRUE))), "_common.R"))

p <- load_params()
sp <- stage_params(p, "cell_qc")
meta <- sample_table(p)

objs <- lapply(p$samples$id, function(s) {
  o <- CreateSeuratObject(read_clean_counts(p, s), project = s, min.cells = sp$min_cells)
  o$sample <- s
  o$condition <- meta[s, "condition"]
  o$replicate <- meta[s, "replicate"]
  if ("batch" %in% colnames(meta)) o$batch <- meta[s, "batch"]
  o[["percent.mt"]] <- PercentageFeatureSet(o, pattern = mito_pattern(p))
  o
})
obj <- if (length(objs) > 1) merge(objs[[1]], objs[-1], add.cell.ids = p$samples$id) else objs[[1]]

# Keep the unfiltered metrics so the app can draw distributions with thresholds.
write.csv(obj@meta.data[, c("sample", "nFeature_RNA", "nCount_RNA", "percent.mt")],
          res_path(p, "cell_qc_metrics.csv"))

before <- table(obj$sample)
obj <- subset(obj, subset = nFeature_RNA >= sp$min_features &
                            nFeature_RNA <= sp$max_features &
                            percent.mt <= sp$max_percent_mt)
after <- table(obj$sample)

obj <- JoinLayers(obj)
saveRDS(obj, obj_path(p, "qc"))
write_json_result(list(
  thresholds = sp,
  cells_before = as.list(before),
  cells_after = as.list(after)
), p, "cell_qc.json")
