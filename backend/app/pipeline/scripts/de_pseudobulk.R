# Stage 10: pseudobulk differential expression.
# AggregateExpression sums raw counts per cell type × sample; DESeq2 then tests condition within
# each cell type, treating biological samples (not cells) as replicates.
source(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(), value = TRUE))), "_common.R"))
suppressPackageStartupMessages(library(DESeq2))

p <- load_params()
sp <- stage_params(p, "de")
obj <- readRDS(obj_path(p, "annotated"))
meta <- sample_table(p)

# AggregateExpression rewrites "_" as "-" in group names, so build safe keys ourselves.
safe <- function(x) gsub("[^A-Za-z0-9]+", "-", x)
obj$ct_key <- safe(obj$cell_type)
obj$pb_key <- paste(obj$ct_key, safe(obj$sample), sep = ".")
lookup <- unique(data.frame(pb_key = obj$pb_key, ct_key = obj$ct_key, cell_type = obj$cell_type,
                            sample = obj$sample, stringsAsFactors = FALSE))
cells_per <- table(obj$pb_key)

counts <- AggregateExpression(obj, assays = "RNA", group.by = "pb_key", return.seurat = FALSE)$RNA
colnames(counts) <- gsub("_", "-", colnames(counts))
lookup$pb_key <- gsub("_", "-", lookup$pb_key)
names(cells_per) <- gsub("_", "-", names(cells_per))

dir.create(res_path(p, "de"), showWarnings = FALSE)
summary <- list()

for (ct in unique(lookup$cell_type)) {
  rows <- lookup[lookup$cell_type == ct & cells_per[lookup$pb_key] >= sp$min_cells, ]
  cd <- data.frame(row.names = rows$pb_key, sample = rows$sample,
                   condition = meta[rows$sample, "condition"])
  if (any(table(cd$condition) < 2) || length(unique(cd$condition)) < 2) {
    summary[[ct]] <- list(skipped = "Fewer than two pseudobulk replicates per condition")
    next
  }
  cd$condition <- relevel(factor(cd$condition), ref = sp$reference)
  design <- if ("batch" %in% colnames(meta) && length(unique(meta[rows$sample, "batch"])) > 1) {
    cd$batch <- factor(meta[rows$sample, "batch"]); ~ batch + condition
  } else ~ condition

  m <- round(as.matrix(counts[, rows$pb_key, drop = FALSE]))
  dds <- DESeqDataSetFromMatrix(m, cd, design)
  dds <- dds[rowSums(counts(dds) >= 10) >= min(table(cd$condition)), ]
  dds <- DESeq(dds, quiet = TRUE)

  test <- setdiff(levels(cd$condition), sp$reference)[1]
  res <- results(dds, contrast = c("condition", test, sp$reference), alpha = sp$padj)
  if (isTRUE(sp$shrink) && requireNamespace("apeglm", quietly = TRUE)) {
    coef <- paste0("condition_", make.names(test), "_vs_", make.names(sp$reference))
    if (coef %in% resultsNames(dds)) res$log2FoldChange <- lfcShrink(dds, coef = coef, type = "apeglm", quiet = TRUE)$log2FoldChange
  }
  out <- data.frame(gene = rownames(res), base_mean = res$baseMean, log2fc = res$log2FoldChange,
                    pvalue = res$pvalue, padj = res$padj)
  out <- out[order(out$padj), ]
  write.csv(out, res_path(p, "de", paste0(safe(ct), ".csv")), row.names = FALSE)

  vsd <- assay(varianceStabilizingTransformation(dds, blind = FALSE, fitType = "local"))
  write.csv(vsd[head(out$gene[!is.na(out$padj)], 50), , drop = FALSE],
            res_path(p, "de", paste0(safe(ct), "_vst_top50.csv")))

  sig <- !is.na(out$padj) & out$padj < sp$padj
  summary[[ct]] <- list(up = sum(sig & out$log2fc >= sp$lfc), down = sum(sig & out$log2fc <= -sp$lfc),
                        tested = nrow(out), contrast = paste(test, "vs", sp$reference))
}

write_json_result(summary, p, "de_summary.json")
