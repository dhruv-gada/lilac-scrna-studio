# Shared helpers for the Seurat stages. Each stage script sources this file, reads the run's
# params.json (path given as the only argument), and reads/writes objects under <work>/objects.

suppressPackageStartupMessages({
  library(jsonlite)
  library(Matrix)
  library(Seurat)
})

load_params <- function() {
  args <- commandArgs(trailingOnly = TRUE)
  if (length(args) < 1) stop("Usage: Rscript <stage>.R <params.json>")
  p <- fromJSON(args[1], simplifyVector = TRUE)
  dir.create(file.path(p$work_dir, "objects"), showWarnings = FALSE, recursive = TRUE)
  dir.create(file.path(p$work_dir, "results"), showWarnings = FALSE, recursive = TRUE)
  p
}

stage_params <- function(p, stage) p$config[[stage]]$params

obj_path <- function(p, name) file.path(p$work_dir, "objects", paste0(name, ".rds"))
res_path <- function(p, ...) file.path(p$work_dir, "results", ...)

# Read a count matrix for one sample from STARsolo or kallisto output.
# which = "raw" (all droplets) or "filtered" (called cells).
read_counts <- function(p, sample, which = c("raw", "filtered")) {
  which <- match.arg(which)
  base <- file.path(p$work_dir, "align", sample)
  if (p$config$align$tool == "starsolo") {
    m <- Read10X(file.path(base, "Solo.out", "Gene", which))
  } else {
    dir <- file.path(base, if (which == "raw") "counts_unfiltered" else "counts_filtered")
    m <- t(readMM(file.path(dir, "cells_x_genes.mtx")))
    names_file <- file.path(dir, "cells_x_genes.genes.names.txt")
    genes <- readLines(if (file.exists(names_file)) names_file else file.path(dir, "cells_x_genes.genes.txt"))
    rownames(m) <- make.unique(genes)
    colnames(m) <- readLines(file.path(dir, "cells_x_genes.barcodes.txt"))
    m <- as(m, "CsparseMatrix")
  }
  m
}

# The cleaned matrix after ambient RNA removal (or the filtered matrix when that stage is off).
read_clean_counts <- function(p, sample) {
  ambient <- p$config$ambient
  if (isTRUE(ambient$enabled) && ambient$tool == "soupx") {
    return(readRDS(obj_path(p, paste0("soupx_", sample))))
  }
  if (isTRUE(ambient$enabled) && ambient$tool == "cellbender") {
    if (!requireNamespace("scCustomize", quietly = TRUE)) stop("Install scCustomize to read CellBender output.")
    return(scCustomize::Read_CellBender_h5_Mat(
      file.path(p$work_dir, "ambient", sample, "cellbender_filtered.h5")))
  }
  read_counts(p, sample, "filtered")
}

sample_table <- function(p) {
  s <- as.data.frame(p$samples, stringsAsFactors = FALSE)
  rownames(s) <- s$id
  s
}

write_json_result <- function(x, p, name) {
  write_json(x, res_path(p, name), auto_unbox = TRUE, digits = NA, pretty = TRUE)
}

mito_pattern <- function(p) if (identical(p$organism, "mouse")) "^mt-" else "^MT-"
