import { useEffect, useMemo, useState } from "react";
import { api } from "../../lib/api";
import type { DEGene } from "../../lib/types";
import { fmtInt, fmtP, useLoad } from "../../lib/util";
import { Heatmap, Volcano } from "../../components/plots";
import { Icon, Panel, Segmented, Skeleton, toast } from "../../components/ui";
import type { RunCtx } from "../RunDetail";
import { NotYet } from "../RunDetail";

type Sort = "padj" | "log2fc" | "gene";

export function DETab({ ctx }: { ctx: RunCtx }) {
  const ready = ctx.stageDone("de") && ctx.run.stages.find((s) => s.id === "de")?.state === "done";
  const summary = useLoad(() => (ready ? api.deSummary(ctx.run.id) : Promise.resolve(null)), [ctx.run.id, ready]);
  const [cellType, setCellType] = useState<string | null>(null);
  useEffect(() => {
    if (summary.data && !cellType) {
      const best = [...summary.data.cell_types].sort((a, b) => b.up + b.down - (a.up + a.down))[0];
      setCellType(best?.cell_type ?? null);
    }
  }, [summary.data, cellType]);
  const de = useLoad(() => (cellType ? api.de(ctx.run.id, cellType) : Promise.resolve(null)), [ctx.run.id, cellType]);

  const [padj, setPadj] = useState(String(ctx.run.config.de.params.padj ?? 0.05));
  const [lfc, setLfc] = useState(Number(ctx.run.config.de.params.lfc ?? 0.5));
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ by: Sort; dir: 1 | -1 }>({ by: "padj", dir: 1 });
  const [limit, setLimit] = useState(25);

  const genes = de.data?.genes ?? [];
  const p = Number(padj);
  const isSig = (g: DEGene) => g.padj < p && Math.abs(g.log2fc) >= lfc;
  const table = useMemo(() => {
    const q = query.trim().toUpperCase();
    const rows = genes.filter((g) => (q ? g.gene.toUpperCase().includes(q) : isSig(g)));
    const key = (g: DEGene) => (sort.by === "gene" ? g.gene : sort.by === "log2fc" ? Math.abs(g.log2fc) : g.padj);
    return rows.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * sort.dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genes, query, sort, p, lfc]);

  if (!ready) return <NotYet ctx={ctx} stage="de" what="Differential expression results" />;
  if (!summary.data) return <Skeleton h={480} />;

  const contrast = de.data?.contrast ?? { test: ctx.conditions[1] ?? "", reference: ctx.conditions[0] ?? "" };
  const up = genes.filter((g) => isSig(g) && g.log2fc > 0).length;
  const down = genes.filter((g) => isSig(g) && g.log2fc < 0).length;
  const maxCount = Math.max(...summary.data.cell_types.map((c) => Math.max(c.up, c.down)), 1);
  const sortBtn = (by: Sort, label: string) => (
    <button type="button" onClick={() => setSort({ by, dir: sort.by === by ? (-sort.dir as 1 | -1) : by === "padj" || by === "gene" ? 1 : -1 })}
      aria-label={`Sort by ${label}`}>{label}{sort.by === by ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button>
  );
  const copy = async () => {
    const tsv = ["gene\tlog2fc\tpadj\tbase_mean", ...table.map((g) => `${g.gene}\t${g.log2fc}\t${g.padj}\t${g.base_mean}`)].join("\n");
    try { await navigator.clipboard.writeText(tsv); toast(`Copied ${table.length} rows`); }
    catch { toast("Copying isn't allowed here. Select the table and copy instead."); }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="grid-main" style={{ gridTemplateColumns: "280px minmax(0, 1fr)" }}>
        <Panel title="Cell types" note={`${contrast.test} vs ${contrast.reference} · pseudobulk DESeq2`}>
          <div className="legend" role="listbox" aria-label="Cell type">
            {summary.data.cell_types.map((c) => (
              <button key={c.cell_type} type="button" role="option" aria-selected={c.cell_type === cellType}
                aria-pressed={c.cell_type === cellType} onClick={() => { setCellType(c.cell_type); setSelected(null); setLimit(25); }}
                style={{ gridTemplateColumns: "minmax(0, 1fr) 88px", opacity: 1 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: c.cell_type === cellType ? 600 : 400 }}>{c.cell_type}</span>
                <span style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, alignItems: "center" }}
                  aria-label={`${c.up} up, ${c.down} down`}>
                  <span style={{ display: "flex", justifyContent: "flex-end" }}><span style={{ height: 8, borderRadius: 2, background: "var(--down)", width: `${(c.down / maxCount) * 100}%`, minWidth: c.down ? 2 : 0 }} /></span>
                  <span><span style={{ display: "block", height: 8, borderRadius: 2, background: "var(--up)", width: `${(c.up / maxCount) * 100}%`, minWidth: c.up ? 2 : 0 }} /></span>
                </span>
              </button>
            ))}
          </div>
          <div className="actions muted" style={{ fontSize: "var(--t-sm)", marginTop: 10, gap: 14 }}>
            <span><span className="dot" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--down)", marginRight: 5 }} />Down</span>
            <span><span className="dot" style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "var(--up)", marginRight: 5 }} />Up in {contrast.test}</span>
          </div>
        </Panel>

        <Panel title={cellType ?? ""}
          note={de.data ? `${fmtInt(genes.length)} genes tested · ${up} up and ${down} down in ${contrast.test}` : "Loading…"}
          actions={
            <>
              <Segmented label="Adjusted p cutoff" value={padj} onChange={setPadj}
                options={[{ value: "0.01", label: "p < 0.01" }, { value: "0.05", label: "p < 0.05" }, { value: "0.1", label: "p < 0.1" }]} />
              <label className="check" htmlFor="lfc" style={{ minWidth: 190 }}>
                <span className="num" style={{ whiteSpace: "nowrap" }}>|log₂FC| ≥ {lfc.toFixed(2)}</span>
                <input id="lfc" type="range" min={0} max={2} step={0.05} value={lfc} onChange={(e) => setLfc(Number(e.target.value))} />
              </label>
            </>
          }>
          {de.data ? (
            <Volcano genes={genes} padj={p} lfc={lfc} selected={selected} onSelect={setSelected}
              test={contrast.test} reference={contrast.reference} />
          ) : <Skeleton h={380} />}
        </Panel>
      </div>

      <div className="grid-2" style={{ gridTemplateColumns: "minmax(0, 1.25fr) minmax(0, 1fr)", alignItems: "start" }}>
        <Panel title={query ? `Genes matching “${query}”` : "Significant genes"} note={`${table.length} genes`}
          actions={
            <>
              <div style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: 9, top: 9, color: "var(--ink-2)" }}><Icon name="search" size={15} /></span>
                <input className="input" id="gene-search" aria-label="Find a gene" placeholder="Find a gene" value={query}
                  onChange={(e) => { setQuery(e.target.value); setLimit(25); }} style={{ paddingLeft: 30, width: 180 }} />
              </div>
              <button type="button" className="btn btn-sm" onClick={copy}>Copy as TSV</button>
            </>
          }>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>{sortBtn("gene", "Gene")}</th><th className="r">{sortBtn("log2fc", "log₂FC")}</th><th className="r">{sortBtn("padj", "Adj. p")}</th><th className="r">Base mean</th></tr></thead>
              <tbody>
                {table.slice(0, limit).map((g) => (
                  <tr key={g.gene} className="clickable" onClick={() => setSelected(g.gene)} aria-selected={selected === g.gene}
                    style={selected === g.gene ? { background: "var(--accent-soft)" } : undefined}>
                    <td className="mono">{g.gene}</td>
                    <td className="r" style={{ color: isSig(g) ? (g.log2fc > 0 ? "var(--up)" : "var(--down)") : undefined, fontWeight: 600 }}>
                      {g.log2fc > 0 ? "+" : ""}{g.log2fc.toFixed(2)}</td>
                    <td className="r">{fmtP(g.padj)}</td>
                    <td className="r muted">{fmtInt(g.base_mean)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {table.length > limit && (
            <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={() => setLimit(limit + 50)}>
              Show {Math.min(50, table.length - limit)} more
            </button>
          )}
          {!table.length && <p className="muted" style={{ padding: "12px 0" }}>{query ? "No gene by that name was tested." : "No genes pass these cutoffs. Loosen the adjusted p or fold change cutoff."}</p>}
        </Panel>
        <Panel title="Top genes across samples" note="Variance-stabilized pseudobulk counts, z-scored per gene.">
          {de.data?.heatmap ? (
            <Heatmap rows={de.data.heatmap.rows} samples={de.data.heatmap.samples} reference={contrast.reference}
              conditions={de.data.heatmap.samples.map((s) => ctx.run.samples.find((x) => x.id === s)?.condition ?? "")}
              condColors={ctx.condColor} />
          ) : <Skeleton h={300} />}
          <div className="chips" style={{ marginTop: 8 }}>
            {ctx.conditions.map((c) => <span key={c} className="chip"><span className="dot" style={{ background: ctx.condColor[c] }} />{c}</span>)}
          </div>
        </Panel>
      </div>
    </div>
  );
}
