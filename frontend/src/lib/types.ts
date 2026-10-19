export type StageId =
  | "demux" | "read_qc" | "align" | "ambient" | "cell_qc"
  | "doublets" | "normalize" | "cluster" | "annotate" | "de";

export type ParamType = "int" | "float" | "bool" | "str" | "choice" | "path";

export interface Param {
  key: string;
  label: string;
  type: ParamType;
  default: unknown;
  help?: string;
  choices?: string[] | null;
  min?: number | null;
  max?: number | null;
  step?: number | null;
  unit?: string | null;
}

export interface Tool {
  id: string;
  label: string;
  language: "cli" | "R" | "python";
  summary: string;
  params: Param[];
  calls_cells: boolean;
  available: boolean;
}

export interface Stage {
  id: StageId;
  order: number;
  name: string;
  goal: string;
  inputs: string[];
  outputs: string[];
  tools: Tool[];
  default_tool: string;
  optional: boolean;
}

export interface StageConfig {
  tool: string;
  enabled: boolean;
  params: Record<string, unknown>;
}
export type PipelineConfig = Record<StageId, StageConfig>;

export interface Catalog {
  stages: Stage[];
  standard_preset: PipelineConfig;
}

export interface Sample {
  id: string;
  condition: string;
  replicate: number;
  batch?: string | null;
}

export type StageState = "pending" | "running" | "needs_input" | "done" | "failed" | "skipped";
export type RunState = "draft" | "queued" | "running" | "needs_input" | "done" | "failed" | "cancelled";

export interface StageStatus {
  id: StageId;
  state: StageState;
  started_at: string | null;
  finished_at: string | null;
  progress: number;
  message: string;
}

export interface RunCreate {
  name: string;
  description: string;
  organism: "human" | "mouse";
  reference: string;
  input_type: "bcl" | "fastq";
  input_path: string;
  sample_sheet: string | null;
  samples: Sample[];
  config: PipelineConfig;
}

export interface Run extends RunCreate {
  id: string;
  state: RunState;
  created_at: string;
  updated_at: string;
  stages: StageStatus[];
  demo: boolean;
}

export interface RunSummary {
  id: string;
  name: string;
  description: string;
  state: RunState;
  created_at: string;
  updated_at: string;
  n_samples: number;
  conditions: string[];
  progress: number;
  current_stage: StageId | null;
  cells: number | null;
  demo: boolean;
  stages: { id: StageId; state: StageState }[];
}

export interface Density { lo: number; hi: number; density: number[]; median: number }

export interface QCResults {
  read_qc?: {
    sample: string; total_reads: number; q30: number; mean_quality: number; gc: number;
    adapter: number; duplication: number; status: "pass" | "warn";
  }[];
  alignment?: {
    sample: string; mapped: number; unique: number; cells_called: number; median_umi: number;
    median_genes: number; saturation: number; contamination: number;
  }[];
  cell_qc?: {
    thresholds: { min_features: number; max_features: number; max_percent_mt: number };
    samples: {
      sample: string; n_genes: Density; n_umi: Density; percent_mt: Density;
      cells_before: number; cells_after_qc: number; doublet_rate: number; singlets: number;
    }[];
    funnel: { step: string; cells: number }[];
  };
}

export interface ClusterInfo {
  id: string;
  n: number;
  suggested_label: string | null;
  confidence?: number;
  centroid?: [number, number];
  top_markers?: string[];
}

export interface UmapResult {
  x: number[];
  y: number[];
  cluster: number[];
  sample: number[];
  samples: Sample[];
  clusters: ClusterInfo[];
  features: Record<string, number[]>;
  labels: Record<string, string>;
}

export interface MarkerResult {
  genes?: string[];
  dots?: { cluster: string; gene: string; avg: number; pct: number }[];
  table: { cluster: string; gene: string; avg_log2fc: number; pct_1: number; pct_2: number; p_val_adj: number }[];
}

export interface DESummary {
  cutoffs: { padj: number; lfc: number };
  cell_types: { cell_type: string; up: number; down: number; tested: number }[];
}

export interface DEGene { gene: string; log2fc: number; padj: number; base_mean: number; pvalue?: number }

export interface DEResult {
  cell_type: string;
  contrast?: { factor: string; test: string; reference: string };
  genes: DEGene[];
  heatmap?: { samples: string[]; rows: { gene: string; values: number[] }[] };
}
