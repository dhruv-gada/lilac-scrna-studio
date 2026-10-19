import { useMemo } from "react";
import { api } from "../lib/api";
import type { Run, Stage, StageId } from "../lib/types";
import { fmtWhen, href, useLoad, useTokens, type RunTab } from "../lib/util";
import { Icon, Skeleton, StatusPill, toast } from "../components/ui";
import { PipelineTab } from "./run/PipelineTab";
import { QualityTab } from "./run/QualityTab";
import { ClustersTab } from "./run/ClustersTab";
import { AnnotationTab } from "./run/AnnotationTab";
import { DETab } from "./run/DETab";

export interface RunCtx {
  run: Run;
  stages: Stage[];
  stageDone: (id: StageId) => boolean;
  conditions: string[];
  condColor: Record<string, string>;
  reload: () => void;
}

const TABS: { id: RunTab; label: string }[] = [
  { id: "pipeline", label: "Pipeline" },
  { id: "quality", label: "Quality" },
  { id: "clusters", label: "Clusters" },
  { id: "annotation", label: "Annotation" },
  { id: "de", label: "Differential expression" },
];

export function RunPage({ id, tab, onChange }: { id: string; tab: RunTab; onChange: () => void }) {
  const run = useLoad(() => api.getRun(id), [id], 1500);
  const catalog = useLoad(() => api.catalog(), []);
  const t = useTokens();

  const ctx = useMemo<RunCtx | null>(() => {
    if (!run.data || !catalog.data) return null;
    const r = run.data;
    const ref = String(r.config.de.params.reference);
    const conditions = [...new Set(r.samples.map((s) => s.condition))].sort((a, b) => (a === ref ? -1 : b === ref ? 1 : 0));
    return {
      run: r,
      stages: catalog.data.stages,
      stageDone: (sid) => ["done", "skipped", "needs_input"].includes(r.stages.find((s) => s.id === sid)?.state ?? ""),
      conditions,
      condColor: Object.fromEntries(conditions.map((c, i) => [c, t.cond[i % t.cond.length]])),
      reload: () => { run.reload(); onChange(); },
    };
  }, [run.data, catalog.data, t, onChange]);

  if (run.error) {
    return (
      <div className="page">
        <a className="btn btn-quiet btn-sm" href={href({ page: "runs" })} style={{ alignSelf: "flex-start" }}><Icon name="back" /> Runs</a>
        <div className="banner banner-bad"><div><strong>Couldn't open this run.</strong><span>{run.error.message}</span></div></div>
      </div>
    );
  }
  if (!ctx) return <div className="page"><Skeleton h={80} /><Skeleton h={420} /></div>;
  const r = ctx.run;
  const failed = r.stages.find((s) => s.state === "failed");
  const stageName = (sid: string) => ctx.stages.find((s) => s.id === sid)?.name ?? sid;

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); toast(msg); ctx.reload(); } catch (e) { toast((e as Error).message); }
  };

  return (
    <div className="page">
      <div className="run-head">
        <a className="btn btn-quiet btn-sm" href={href({ page: "runs" })} style={{ alignSelf: "flex-start", marginLeft: -10 }}>
          <Icon name="back" /> Runs
        </a>
        <header className="page-head">
          <div>
            <div className="actions"><h1 className="page-title">{r.name}</h1><StatusPill state={r.state} /></div>
            {r.description && <p className="page-sub">{r.description}</p>}
            <div className="chips" style={{ marginTop: 4 }}>
              {ctx.conditions.map((c) => (
                <span key={c} className="chip"><span className="dot" style={{ background: ctx.condColor[c] }} />
                  {c} · {r.samples.filter((s) => s.condition === c).length}{c === String(r.config.de.params.reference) ? " · reference" : ""}</span>
              ))}
              <span className="chip">{r.reference}</span>
              <span className="chip">Updated {fmtWhen(r.updated_at).replace("Just now", "just now")}</span>
            </div>
          </div>
          <div className="actions">
            {(r.state === "running" || r.state === "queued") && (
              <button type="button" className="btn" onClick={() => act(() => api.cancelRun(r.id), "Run cancelled")}><Icon name="stop" /> Cancel run</button>
            )}
            {(r.state === "failed" || r.state === "cancelled") && (
              <button type="button" className="btn btn-primary" onClick={() => act(() => api.retryRun(r.id), `Retrying from ${stageName(failed?.id ?? "")}`)}>
                <Icon name="retry" /> {failed ? `Retry from stage ${ctx.stages.find((s) => s.id === failed.id)?.order}` : "Run again"}
              </button>
            )}
          </div>
        </header>

        {r.state === "needs_input" && tab !== "annotation" && (
          <div className="banner banner-warn">
            <div><strong>Clusters are ready to name</strong><span>The run is paused before differential expression until each cluster has a cell type.</span></div>
            <a className="btn btn-sm" href={href({ page: "run", id: r.id, tab: "annotation" })}>Name clusters</a>
          </div>
        )}
        {failed && r.state === "failed" && (
          <div className="banner banner-bad">
            <div><strong>{stageName(failed.id)} failed</strong><span>{failed.message}</span></div>
            <a className="btn btn-sm" href={href({ page: "run", id: r.id, tab: "pipeline" })}>View log</a>
          </div>
        )}

        <nav className="tabs" aria-label="Run sections">
          {TABS.map((tb) => (
            <a key={tb.id} href={href({ page: "run", id: r.id, tab: tb.id })} aria-current={tab === tb.id ? "page" : undefined}>
              {tb.label}
              {tb.id === "annotation" && r.state === "needs_input" && <span className="tab-badge" aria-label="Needs input" />}
            </a>
          ))}
        </nav>
      </div>

      {tab === "pipeline" && <PipelineTab ctx={ctx} />}
      {tab === "quality" && <QualityTab ctx={ctx} />}
      {tab === "clusters" && <ClustersTab ctx={ctx} />}
      {tab === "annotation" && <AnnotationTab ctx={ctx} />}
      {tab === "de" && <DETab ctx={ctx} />}
    </div>
  );
}

export function NotYet({ ctx, stage, what }: { ctx: RunCtx; stage: StageId; what: string }) {
  const s = ctx.stages.find((x) => x.id === stage)!;
  const st = ctx.run.stages.find((x) => x.id === stage)!;
  return (
    <div className="panel">
      <div className="empty">
        <h3>{what} appear after stage {s.order}, {s.name.toLowerCase()}</h3>
        <p>{st.state === "running" ? `That stage is running now (${Math.round(st.progress * 100)}%).`
          : ctx.run.state === "failed" ? "The run stopped before reaching it. Retry the run to continue."
          : "This page fills in on its own as the run progresses."}</p>
        <a className="btn btn-sm" href={href({ page: "run", id: ctx.run.id, tab: "pipeline" })}>Follow the pipeline</a>
      </div>
    </div>
  );
}
