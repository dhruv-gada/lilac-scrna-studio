import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { MarkerResult, UmapResult } from "../../lib/types";
import { fmtInt, go, useLoad, useTokens } from "../../lib/util";
import { DotPlot, Umap } from "../../components/plots";
import { Panel, Skeleton, toast } from "../../components/ui";
import type { RunCtx } from "../RunDetail";
import { NotYet } from "../RunDetail";

export function AnnotationTab({ ctx }: { ctx: RunCtx }) {
  const ready = ctx.stageDone("cluster");
  const data = useLoad(async () => (ready ? Promise.all([api.umap(ctx.run.id), api.markers(ctx.run.id)]) : null), [ctx.run.id, ready]);
  if (!ready) return <NotYet ctx={ctx} stage="cluster" what="Clusters to annotate" />;
  if (!data.data) return <Skeleton h={480} />;
  return <AnnotationView ctx={ctx} u={data.data[0]} m={data.data[1]} />;
}

function AnnotationView({ ctx, u, m }: { ctx: RunCtx; u: UmapResult; m: MarkerResult }) {
  const t = useTokens();
  const waiting = ctx.run.state === "needs_input";
  const auto = ctx.run.config.annotate.tool === "celltypist";
  const [labels, setLabels] = useState<Record<string, string>>(() =>
    Object.fromEntries(u.clusters.map((c) => [c.id, u.labels[c.id] ?? ""])));
  const [saving, setSaving] = useState(false);
  useEffect(() => { setLabels(Object.fromEntries(u.clusters.map((c) => [c.id, u.labels[c.id] ?? ""]))); }, [u]);

  const filled = u.clusters.filter((c) => labels[c.id]?.trim()).length;
  const names = useMemo(() => [...new Set(u.clusters.map((c) => labels[c.id]?.trim() || `Cluster ${c.id}`))], [labels, u.clusters]);
  const group = useMemo(() => u.cluster.map((ci) => names.indexOf(labels[u.clusters[ci].id]?.trim() || `Cluster ${u.clusters[ci].id}`)), [u, labels, names]);
  const centroids = useMemo(() => names.map((nm, i) => {
    let sx = 0, sy = 0, n = 0;
    group.forEach((g, k) => { if (g === i) { sx += u.x[k]; sy += u.y[k]; n++; } });
    return { text: nm, x: sx / n, y: sy / n, color: t.cat[i % t.cat.length] };
  }), [names, group, u, t]);

  const useSuggestions = () => setLabels(Object.fromEntries(u.clusters.map((c) => [c.id, c.suggested_label ?? labels[c.id] ?? ""])));
  const save = async () => {
    setSaving(true);
    try {
      await api.saveAnnotations(ctx.run.id, labels);
      toast(waiting ? "Labels saved. Differential expression is running." : "Labels saved");
      ctx.reload();
      if (waiting) go({ page: "run", id: ctx.run.id, tab: "pipeline" });
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {waiting && (
        <div className="banner banner-warn">
          <div>
            <strong>Name each cluster to continue</strong>
            <span>Differential expression compares conditions within each cell type, so it starts once clusters have names. Clusters you give the same name are merged.</span>
          </div>
        </div>
      )}
      <div className="grid-2" style={{ alignItems: "start" }}>
        <Panel title="Clusters" note={auto ? "Labels from CellTypist with majority voting. Edit any you disagree with." : "Suggestions come from canonical markers. Check them against the dot plot."}
          actions={<button type="button" className="btn btn-sm" onClick={useSuggestions}>Use all suggestions</button>}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Cluster</th><th className="r">Cells</th><th>Top markers</th><th>Cell type</th></tr></thead>
              <tbody>
                {u.clusters.map((c, i) => (
                  <tr key={c.id}>
                    <td><span className="chip" style={{ background: "transparent", padding: 0, color: "var(--ink)" }}>
                      <span className="dot" style={{ background: t.cat[i % t.cat.length], width: 10, height: 10, borderRadius: 3 }} />{c.id}</span></td>
                    <td className="r">{fmtInt(c.n)}</td>
                    <td><div className="chips">{(c.top_markers ?? []).slice(0, 2).map((g) => <span key={g} className="chip mono">{g}</span>)}</div></td>
                    <td style={{ minWidth: 190 }}>
                      <input className="input" id={`label-${c.id}`} aria-label={`Cell type for cluster ${c.id}`} value={labels[c.id] ?? ""}
                        placeholder={c.suggested_label ? `Suggested: ${c.suggested_label}` : "Cell type"}
                        list="celltype-suggestions" onChange={(e) => setLabels({ ...labels, [c.id]: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <datalist id="celltype-suggestions">
              {[...new Set(u.clusters.map((c) => c.suggested_label).filter(Boolean))].map((s) => <option key={s!} value={s!} />)}
            </datalist>
          </div>
          <div className="actions" style={{ justifyContent: "space-between", marginTop: 14 }}>
            <span className="muted num" style={{ fontSize: "var(--t-sm)" }}>{filled} of {u.clusters.length} named · {names.length} cell types</span>
            <button type="button" className="btn btn-primary" disabled={!filled || saving} onClick={save}>
              {saving ? "Saving…" : waiting ? "Save and run differential expression" : "Save labels"}
            </button>
          </div>
        </Panel>
        <Panel title="Preview" note="Updates as you type.">
          <Umap x={u.x} y={u.y} group={group} colors={names.map((_, i) => t.cat[i % t.cat.length])} labels={centroids}
            describe={(k) => `${names[group[k]]} · cluster ${u.clusters[u.cluster[k]].id}`} ariaLabel="UMAP colored by the cell type labels being edited" height={420} />
        </Panel>
      </div>
      {m.dots && m.genes && (
        <Panel title="Canonical markers by cluster" note="Dot size is the share of cells expressing the gene; color is average expression.">
          <DotPlot genes={m.genes} dots={m.dots} colors={t.cat}
            clusters={u.clusters.map((c) => ({ id: c.id, label: `${c.id} · ${labels[c.id]?.trim() || "unnamed"}` }))} />
        </Panel>
      )}
    </div>
  );
}
