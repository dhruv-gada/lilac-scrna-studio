# Stage 7 (Seurat): NormalizeData > FindVariableFeatures > ScaleData, one layer per sample so
# stage 8 can integrate across samples.
source(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(), value = TRUE))), "_common.R"))

p <- load_params()
sp <- stage_params(p, "normalize")
obj <- readRDS(obj_path(p, "singlets"))

obj[["RNA"]] <- split(obj[["RNA"]], f = obj$sample)

if (identical(sp$method, "SCTransform")) {
  obj <- SCTransform(obj, variable.features.n = sp$n_hvg, vars.to.regress = "percent.mt", verbose = FALSE)
} else {
  obj <- NormalizeData(obj, normalization.method = "LogNormalize", scale.factor = sp$scale_factor)
  obj <- FindVariableFeatures(obj, selection.method = "vst", nfeatures = sp$n_hvg)
  obj <- ScaleData(obj)
}

saveRDS(obj, obj_path(p, "normalized"))
write_json_result(list(method = sp$method, variable_features = head(VariableFeatures(obj), 50)),
                  p, "normalize.json")
