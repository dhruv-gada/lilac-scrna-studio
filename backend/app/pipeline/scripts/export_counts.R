# Stage 9 (CellTypist), step 1: export the clustered object's raw counts and cluster IDs as
# a 10x-style MTX folder so the Python classifier can read them.
source(file.path(dirname(sub("--file=", "", grep("--file=", commandArgs(), value = TRUE))), "_common.R"))

p <- load_params()
obj <- readRDS(obj_path(p, "clustered"))
out <- file.path(p$work_dir, "objects", "for_python")
dir.create(out, showWarnings = FALSE, recursive = TRUE)

counts <- LayerData(obj, assay = "RNA", layer = "counts")
writeMM(counts, file.path(out, "matrix.mtx"))
writeLines(rownames(counts), file.path(out, "genes.txt"))
writeLines(colnames(counts), file.path(out, "barcodes.txt"))
write.csv(data.frame(cell = colnames(obj), cluster = obj$clusters), file.path(out, "clusters.csv"),
          row.names = FALSE)
