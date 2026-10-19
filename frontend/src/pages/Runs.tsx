import type { RunSummary } from "../lib/types";
import { fmtInt, fmtWhen, href } from "../lib/util";
import { Empty, Icon, MiniThread, Panel, Skeleton, StatusPill } from "../components/ui";

const STAGE_NAMES: Record<string, string> = {
  demux: "Demultiplexing", read_qc: "Read QC", align: "Alignment", ambient: "Ambient RNA removal",
  cell_qc: "Cell QC", doublets: "Doublet removal", normalize: "Normalization", cluster: "Clustering",
  annotate: "Annotation", de: "Differential expression",
};

export function RunsPage({ runs, loading, error }: { runs: RunSummary[] | null; loading: boolean; error?: string }) {
  const totals = runs ? {
    active: runs.filter((r) => ["running", "queued"].includes(r.state)).length,
    waiting: runs.filter((r) => r.state === "needs_input").length,
    cells: runs.reduce((a, r) => a + (r.cells ?? 0), 0),
  } : null;

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">Runs</h1>
          <p className="page-sub">
            Each run takes raw sequencing data through ten stages, from demultiplexing to
            differential expression between your conditions.
          </p>
        </div>
        <div className="actions">
          <a className="btn btn-primary" href={href({ page: "new" })}><Icon name="plus" /> New run</a>
        </div>
      </header>

      {totals && runs!.length > 0 && (
        <div className="stat-row">
          <div className="stat"><b>{runs!.length}</b><span>Runs</span></div>
          <div className="stat"><b>{totals.active}</b><span>Running now</span></div>
          <div className="stat"><b>{totals.waiting}</b><span>Waiting for you</span></div>
          <div className="stat"><b>{fmtInt(totals.cells)}</b><span>Cells analyzed</span></div>
        </div>
      )}

      {error && <div className="banner banner-bad"><div><strong>Couldn't load runs.</strong><span>{error}</span></div></div>}

      <Panel bodyClass="flush">
        {loading && !runs ? <Skeleton h={220} /> : runs && runs.length === 0 ? (
          <Empty title="No runs yet" action={<a className="btn btn-primary" href={href({ page: "new" })}>Start your first run</a>}>
            Point a run at a BCL folder or FASTQ files, tell it which samples belong to which condition, and it
            will take care of the rest.
          </Empty>
        ) : (
          <div role="list" style={{ margin: "-14px -16px -16px" }}>
            {runs?.map((r) => {
              const tab = r.state === "needs_input" ? "annotation" : r.state === "done" ? "clusters" : "pipeline";
              return (
                <a role="listitem" key={r.id} className="run-row" href={href({ page: "run", id: r.id, tab })}>
                  <div style={{ minWidth: 0 }}>
                    <div className="run-name">{r.name}</div>
                    <div className="run-desc">{r.description || "No description"}</div>
                    <div className="run-stage">
                      {r.state === "done" ? `${r.n_samples} samples · ${r.conditions.join(" vs ")}${r.cells ? ` · ${fmtInt(r.cells)} cells` : ""}`
                        : r.state === "needs_input" ? "Clusters are ready to name"
                        : r.current_stage ? `${STAGE_NAMES[r.current_stage]}${r.state === "failed" ? " failed" : ""}`
                        : `${r.n_samples} samples · ${r.conditions.join(" vs ")}`}
                    </div>
                  </div>
                  <div className="hide-sm"><MiniThread stages={r.stages} /></div>
                  <div><StatusPill state={r.state} /></div>
                  <div className="hide-sm muted num" style={{ fontSize: "var(--t-sm)", textAlign: "right" }}>{fmtWhen(r.updated_at)}</div>
                </a>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}
