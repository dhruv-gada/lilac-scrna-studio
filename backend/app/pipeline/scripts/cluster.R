# Stage 8 (Seurat): RunPCA > IntegrateLayers > FindNeighbors > FindClusters > RunUMAP >
# JoinLayers > DimPlot. Writes the embedding and cluster markers for the app, and
# publication-ready UMAP figures (PDF + 600 dpi PNG).
source(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(), value = TRUE))), "_common.R"))
suppressPackageStartupMessages(library(ggplot2))

p <- load_params()
sp <- stage_params(p, "cluster")
obj <- readRDS(obj_path(p, "normalized"))
dims <- seq_len(sp$n_pcs)
sct <- identical(stage_params(p, "normalize")$method, "SCTransform")

obj <- RunPCA(obj, npcs = sp$n_pcs, verbose = FALSE)

reduction <- "pca"
if (!identical(sp$integration, "None") && length(unique(obj$sample)) > 1) {
  method <- switch(sp$integration,
                   CCA = CCAIntegration, RPCA = RPCAIntegration, Harmony = HarmonyIntegration)
  obj <- IntegrateLayers(obj, method = method, orig.reduction = "pca",
                         new.reduction = "integrated",
                         normalization.method = if (sct) "SCT" else "LogNormalize",
                         verbose = FALSE)
  reduction <- "integrated"
}

obj <- FindNeighbors(obj, reduction = reduction, dims = dims)
obj <- FindClusters(obj, resolution = sp$resolution, cluster.name = "clusters")
obj <- RunUMAP(obj, reduction = reduction, dims = dims, min.dist = sp$min_dist, reduction.name = "umap")
if (!sct) obj <- JoinLayers(obj)

# Publication figure: no axes ticks, labeled clusters, fixed aspect.
fig <- DimPlot(obj, reduction = "umap", group.by = "clusters", label = TRUE, repel = TRUE, pt.size = 0.2) +
  coord_fixed() + theme(axis.text = element_blank(), axis.ticks = element_blank()) + NoLegend()
ggsave(res_path(p, "umap_clusters.pdf"), fig, width = 6, height = 6)
ggsave(res_path(p, "umap_clusters.png"), fig, width = 6, height = 6, dpi = 600)
fig2 <- DimPlot(obj, reduction = "umap", group.by = "condition", pt.size = 0.2, shuffle = TRUE) + coord_fixed()
ggsave(res_path(p, "umap_condition.pdf"), fig2, width = 7, height = 6)

emb <- Embeddings(obj, "umap")
write.csv(data.frame(cell = rownames(emb), x = emb[, 1], y = emb[, 2],
                     cluster = obj$clusters, sample = obj$sample, condition = obj$condition),
          res_path(p, "umap.csv"), row.names = FALSE)

if (sct) obj <- PrepSCTFindMarkers(obj)
markers <- FindAllMarkers(obj, only.pos = TRUE, min.pct = 0.25, logfc.threshold = 0.5, verbose = FALSE)
write.csv(markers, res_path(p, "cluster_markers.csv"), row.names = FALSE)

saveRDS(obj, obj_path(p, "clustered"))
