import type {
  Catalog, DEResult, DESummary, MarkerResult, QCResults, Run, RunCreate, RunSummary, StageId, UmapResult,
} from "./types";
import { mockApi } from "./mock";

export interface Api {
  mode: "api" | "mock";
  health(): Promise<{ ok: boolean; demo_mode: boolean }>;
  catalog(): Promise<Catalog>;
  listRuns(): Promise<RunSummary[]>;
  getRun(id: string): Promise<Run>;
  createRun(body: RunCreate): Promise<Run>;
  cancelRun(id: string): Promise<Run>;
  retryRun(id: string): Promise<Run>;
  logs(id: string, stage: StageId): Promise<string[]>;
  saveAnnotations(id: string, labels: Record<string, string>): Promise<Run>;
  qc(id: string): Promise<QCResults>;
  umap(id: string): Promise<UmapResult>;
  markers(id: string): Promise<MarkerResult>;
  deSummary(id: string): Promise<DESummary>;
  de(id: string, cellType: string): Promise<DEResult>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function httpApi(base: string): Api {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}/api${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      let detail = res.statusText;
      try {
        const body = await res.json();
        detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
      } catch { /* keep statusText */ }
      throw new ApiError(res.status, detail);
    }
    return res.json() as Promise<T>;
  }
  const enc = encodeURIComponent;
  return {
    mode: "api",
    health: () => call("/health"),
    catalog: () => call("/pipeline/stages"),
    listRuns: () => call("/runs"),
    getRun: (id) => call(`/runs/${enc(id)}`),
    createRun: (body) => call("/runs", { method: "POST", body: JSON.stringify(body) }),
    cancelRun: (id) => call(`/runs/${enc(id)}/cancel`, { method: "POST" }),
    retryRun: (id) => call(`/runs/${enc(id)}/start`, { method: "POST" }),
    logs: async (id, stage) => (await call<{ lines: string[] }>(`/runs/${enc(id)}/logs/${stage}`)).lines,
    saveAnnotations: (id, labels) =>
      call(`/runs/${enc(id)}/annotations`, { method: "PUT", body: JSON.stringify({ labels }) }),
    qc: (id) => call(`/runs/${enc(id)}/results/qc`),
    umap: (id) => call(`/runs/${enc(id)}/results/umap`),
    markers: (id) => call(`/runs/${enc(id)}/results/markers`),
    deSummary: (id) => call(`/runs/${enc(id)}/results/de`),
    de: (id, ct) => call(`/runs/${enc(id)}/results/de/${enc(ct)}`),
  };
}

export const api: Api =
  import.meta.env.VITE_DATA_SOURCE === "mock"
    ? mockApi
    : httpApi((import.meta.env.VITE_API_URL as string | undefined) ?? "");
