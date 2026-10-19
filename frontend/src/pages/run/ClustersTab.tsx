import { useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { UmapResult } from "../../lib/types";
import { fmtInt, useLoad, useTokens } from "../../lib/util";
import { Umap } from "../../components/plots";
import { Panel, Segmented, Skeleton, toast } from "../../components/ui";
import type { RunCtx } from "../RunDetail";
import { NotYet } from "../RunDetail";

type ColorBy = "cluster" | "celltype" | "condition" | "sample" | "gene";

export function ClustersTab({ ctx }: { ctx: RunCtx }) {
  const ready = ctx.stageDone("cluster");
  const annState = ctx.run.stages.find((s) => s.id === "annotate")?.state;
  const umap = useLoad(() => (ready ? api.umap(ctx.run.id) : Promise.resolve(null)), [ctx.run.id, ready, annState]);
  if (!ready) return <NotYet ctx={ctx} stage="cluster" what="Clusters and the UMAP" />;
  if (!umap.data) return <Skeleton h={520} />;
  return <ClustersView ctx={ctx} u={umap.data} />;
}

function ClustersView({ ctx, u }: { ctx: RunCtx; u: UmapResult }) {
  const t = useTokens();
  const hasLabels = Object.keys(u.labels).length > 0;
  const [colorBy, setColorBy] = useState<ColorBy>(hasLabels ? "celltype" : "cluster");
  const genes = Object.keys(u.features);
  const [gene, setGene] = useState(genes[0] ?? "");
  const [hidden, setHidden] = useState<Set<number>>(new Set());

  const view = useMemo(() => {
    const conds = ctx.conditions;
    if (colorBy === "condition") {
      const g = u.sample.map((si) => conds.indexOf(u.samples[si].condition));
      return { group: g, colors: conds.map((c) => ctx.condColor[c]),
        legend: conds.map((c, i) => ({ i, label: c, color: ctx.condColor[c], n: g.filter((x) => x === i).length })) };
    }
    if (colorBy === "sample") {
      return { group: u.sample, colors: u.samples.map((_, i) => t.cat[(i * 2 + 1) % t.cat.length]),
        legend: u.samples.map((s, i) => ({ i, label: s.id, color: t.cat[(i * 2 + 1) % t.cat.length], n: u.sample.filter((x) => x === i).length })) };
    }
    if (colorBy === "celltype" && hasLabels) {
      const names = [...new Set(u.clusters.map((c) => u.labels[c.id] ?? `Cluster ${c.id}`))];
      const g = u.cluster.map((ci) => names.indexOf(u.labels[u.clusters[ci].id] ?? `Cluster ${u.clusters[ci].id}`));
      return { group: g, colors: names.map((_, i) => t.cat[i % t.cat.length]),
        legend: names.map((nm, i) => ({ i, label: nm, color: t.cat[i % t.cat.length], n: g.filter((x) => x === i).length })) };
    }
    return { group: u.cluster, colors: u.clusters.map((_, i) => t.cat[i % t.cat.length]),
      legend: u.clusters.map((c, i) => ({ i, label: `Cluster ${c.id}`, color: t.cat[i % t.cat.length], n: c.n })) };
  }, [colorBy, u, t, ctx.conditions, ctx.condColor, hasLabels]);

  const labels = useMemo(() => {
    if (colorBy !== "cluster" && colorBy !== "celltype") return undefined;
    const sums = new Map<number, [number, number, number]>();
    view.group.forEach((g, i) => {
      const s = sums.get(g) ?? [0, 0, 0];
      s[0] += u.x[i]; s[1] += u.y[i]; s[2]++; sums.set(g, s);
    });
    return view.legend.filter((l) => !hidden.has(l.i)).map((l) => {
      const s = sums.get(l.i)!;
      return { text: colorBy === "cluster" ? l.label.replace("Cluster ", "") : l.label, x: s[0] / s[2], y: s[1] / s[2], color: l.color };
    });
  }, [view, colorBy, u, hidden]);

  // Composition always shows discrete groups: the current grouping if it is one, else clusters.
  const compView = colorBy === "celltype" || colorBy === "cluster" ? view : {
    group: u.cluster,
    legend: u.clusters.map((c, i) => ({ i, label: u.labels[c.id] ?? `Cluster ${c.id}`, color: t.cat[i % t.cat.length], n: c.n })),
  };

  const visible = hidden.size ? new Set(view.legend.map((l) => l.i).filter((i) => !hidden.has(i))) : undefined;
  const toggle = (i: number) => {
    const next = new Set(hidden);
    if (next.has(i)) next.delete(i); else next.add(i);
    if (next.size === view.legend.length) next.clear();
    setHidden(next);
  };
  const describe = (i: number) => {
    const c = u.clusters[u.cluster[i]];
    const base = `${u.labels[c.id] ?? `Cluster ${c.id}`} · ${u.samples[u.sample[i]].id}`;
    return colorBy === "gene" ? `${gene} ${(u.features[gene][i] / 25).toFixed(2)} · ${base}` : base;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="grid-main">
        <Panel
          title={`${fmtInt(u.x.length)} cells · ${u.clusters.length} clusters`}
          note={ctx.run.demo ? "Showing a 6,000-cell subsample for speed. Exports use every cell." : undefined}
          actions={
            <>
              <Segmented label="Color cells by" value={colorBy} onChange={(v) => { setColorBy(v); setHidden(new Set()); }}
                options={[
                  { value: "cluster", label: "Cluster" },
                  ...(hasLabels ? [{ value: "celltype" as ColorBy, label: "Cell type" }] : []),
                  { value: "condition", label: "Condition" },
                  { value: "sample", label: "Sample" },
                  ...(genes.length ? [{ value: "gene" as ColorBy, label: "Gene" }] : []),
                ]} />
            </>
          }>
          <Umap x={u.x} y={u.y} group={colorBy === "gene" ? undefined : view.group} colors={view.colors}
            visible={colorBy === "gene" ? undefined : visible}
            values={colorBy === "gene" ? u.features[gene] : undefined} labels={labels} describe={describe}
            ariaLabel={`UMAP of ${u.x.length} cells colored by ${colorBy === "gene" ? gene : colorBy}`} />
        </Panel>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {colorBy === "gene" ? (
            <Panel title="Gene expression" note="Log-normalized expression; highest cells drawn on top.">
              <div className="field">
                <label htmlFor="gene-pick">Gene</label>
                <select id="gene-pick" className="select mono" value={gene} onChange={(e) => setGene(e.target.value)}>
                  {genes.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="ramp" />
                <div className="actions muted" style={{ justifyContent: "space-between", fontSize: "var(--t-sm)", marginTop: 4 }}><span>0</span><span>4</span></div>
              </div>
            </Panel>
          ) : (
            <Panel title="Legend" note="Select to show or hide a group.">
              <div className="legend">
                {view.legend.map((l) => (
                  <button key={l.i} type="button" aria-pressed={hidden.size ? !hidden.has(l.i) : undefined} onClick={() => toggle(l.i)}>
                    <span className="sw" style={{ background: l.color }} /><span>{l.label}</span><span className="n">{fmtInt(l.n)}</span>
                  </button>
                ))}
              </div>
            </Panel>
          )}
          <Panel title="Figures">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <p className="panel-note">Seurat's DimPlot with fixed aspect ratio, ready for a manuscript: PDF and 600 dpi PNG.</p>
              <button type="button" className="btn" onClick={() => toast(ctx.run.demo ? "Figure files are written by the server for real runs" : "Downloading umap_clusters.pdf")}>UMAP by cluster</button>
              <button type="button" className="btn" onClick={() => toast(ctx.run.demo ? "Figure files are written by the server for real runs" : "Downloading umap_condition.pdf")}>UMAP by condition</button>
            </div>
          </Panel>
        </div>
      </div>
      <Composition ctx={ctx} u={u} group={compView.group} legend={compView.legend} />
    </div>
  );
}

function Composition({ ctx, u, group, legend }: {
  ctx: RunCtx; u: UmapResult; group: number[];
  legend: { i: number; label: string; color: string; n: number }[];
}) {
  const t = useTokens();
  const order = u.samples.map((_, i) => i).sort((a, b) =>
    ctx.conditions.indexOf(u.samples[a].condition) - ctx.conditions.indexOf(u.samples[b].condition));
  const counts = u.samples.map(() => new Array(legend.length).fill(0));
  group.forEach((g, i) => { counts[u.sample[i]][g]++; });
  return (
    <Panel title="Composition by sample" note="Share of each sample's cells in each group. Shifts between conditions show up here before any test.">
      <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 140px) minmax(0, 1fr)", gap: "6px 12px", alignItems: "center" }}>
        {order.map((si) => {
          const total = counts[si].reduce((a: number, b: number) => a + b, 0) || 1;
          return [
            <span key={`l${si}`} className="mono" style={{ fontSize: "var(--t-sm)", display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>
              <span className="dot" style={{ width: 8, height: 8, borderRadius: 4, flex: "none", background: ctx.condColor[u.samples[si].condition] }} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{u.samples[si].id}</span>
            </span>,
            <div key={`b${si}`} style={{ display: "flex", height: 16, borderRadius: 4, overflow: "hidden", background: t.grid }}
              role="img" aria-label={`${u.samples[si].id}: ${legend.map((l) => `${l.label} ${((counts[si][l.i] / total) * 100).toFixed(1)}%`).join(", ")}`}>
              {legend.map((l) => (
                <span key={l.i} title={`${l.label}: ${((counts[si][l.i] / total) * 100).toFixed(1)}%`}
                  style={{ width: `${(counts[si][l.i] / total) * 100}%`, background: l.color }} />
              ))}
            </div>,
          ];
        })}
      </div>
    </Panel>
  );
}
