# Stage 9 (Seurat, manual): draw canonical markers, then apply the cluster labels the person
# chose in the app (params.json → annotations). Run once to produce the plots, and again after
# labels are saved to write the annotated object.
source(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(), value = TRUE))), "_common.R"))
suppressPackageStartupMessages(library(ggplot2))

p <- load_params()
sp <- stage_params(p, "annotate")
obj <- readRDS(obj_path(p, "clustered"))
markers <- trimws(strsplit(sp$markers, ",")[[1]])
markers <- markers[markers %in% rownames(obj)]

ggsave(res_path(p, "feature_plots.pdf"),
       FeaturePlot(obj, features = markers, reduction = "umap", order = TRUE, ncol = 4) & coord_fixed(),
       width = 16, height = 4 * ceiling(length(markers) / 4))
ggsave(res_path(p, "marker_dotplot.pdf"),
       DotPlot(obj, features = unique(markers), group.by = "clusters") + RotatedAxis(),
       width = 12, height = 6)

labels <- p$annotations
if (is.null(labels) || length(labels) == 0) {
  message("No labels yet: waiting for annotation in the app.")
  quit(status = 0)
}
ids <- as.character(obj$clusters)
obj$cell_type <- unname(unlist(labels)[ids])
obj$cell_type[is.na(obj$cell_type)] <- paste0("Cluster ", ids[is.na(obj$cell_type)])

fig <- DimPlot(obj, reduction = "umap", group.by = "cell_type", label = TRUE, repel = TRUE, pt.size = 0.2) +
  coord_fixed() + NoLegend()
ggsave(res_path(p, "umap_cell_types.pdf"), fig, width = 7, height = 7)
ggsave(res_path(p, "umap_cell_types.png"), fig, width = 7, height = 7, dpi = 600)
saveRDS(obj, obj_path(p, "annotated"))
