import { api } from "../../lib/api";
import { fmtInt, fmtPct, fmtReads, useLoad, useTokens } from "../../lib/util";
import { Funnel, Violins } from "../../components/plots";
import { Panel, Skeleton } from "../../components/ui";
import type { RunCtx } from "../RunDetail";
import { NotYet } from "../RunDetail";

export function QualityTab({ ctx }: { ctx: RunCtx }) {
  const doneCount = ctx.run.stages.filter((s) => s.state === "done").length;
  const qc = useLoad(() => api.qc(ctx.run.id), [ctx.run.id, doneCount]);
  const t = useTokens();
  if (!ctx.stageDone("read_qc")) return <NotYet ctx={ctx} stage="read_qc" what="Quality reports" />;
  if (!qc.data) return <Skeleton h={360} />;
  const { read_qc, alignment, cell_qc } = qc.data;
  const sampleColor = (sample: string) => ctx.condColor[ctx.run.samples.find((s) => s.id === sample)?.condition ?? ""] ?? t.accent;
  const warn = read_qc?.filter((r) => r.status === "warn") ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {cell_qc && (
        <div className="grid-main">
          <Panel title="Cells through filtering" note="Summed over all samples. Thresholds come from the run's cell QC settings.">
            <Funnel steps={cell_qc.funnel} />
          </Panel>
          <Panel title="Filters applied">
            <dl className="kv">
              <dt>Genes per cell</dt><dd className="num">{fmtInt(cell_qc.thresholds.min_features)} – {fmtInt(cell_qc.thresholds.max_features)}</dd>
              <dt>Mitochondrial reads</dt><dd className="num">≤ {cell_qc.thresholds.max_percent_mt}%</dd>
              <dt>Doublets</dt><dd>Removed with scDblFinder</dd>
              <dt>Mean doublet rate</dt><dd className="num">{fmtPct((cell_qc.samples.reduce((a, s) => a + s.doublet_rate, 0) / cell_qc.samples.length) * 100)}</dd>
            </dl>
          </Panel>
        </div>
      )}

      {cell_qc && (
        <div className="grid-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
          <Panel title="Genes per cell">
            <Violins metric="Genes per cell" log colors={cell_qc.samples.map((s) => sampleColor(s.sample))}
              samples={cell_qc.samples.map((s) => ({ sample: s.sample, d: s.n_genes }))}
              thresholds={[{ value: Math.log10(cell_qc.thresholds.min_features), label: `min ${cell_qc.thresholds.min_features}` },
                { value: Math.log10(cell_qc.thresholds.max_features), label: `max ${fmtInt(cell_qc.thresholds.max_features)}` }]} />
          </Panel>
          <Panel title="UMIs per cell">
            <Violins metric="UMIs per cell" log colors={cell_qc.samples.map((s) => sampleColor(s.sample))}
              samples={cell_qc.samples.map((s) => ({ sample: s.sample, d: s.n_umi }))} />
          </Panel>
          <Panel title="Mitochondrial reads">
            <Violins metric="Mitochondrial reads" unit="%" colors={cell_qc.samples.map((s) => sampleColor(s.sample))}
              samples={cell_qc.samples.map((s) => ({ sample: s.sample, d: s.percent_mt }))}
              thresholds={[{ value: cell_qc.thresholds.max_percent_mt, label: `max ${cell_qc.thresholds.max_percent_mt}%` }]} />
          </Panel>
        </div>
      )}

      {alignment && (
        <Panel title="Alignment and cell calling" note="Per sample, from STARsolo's summary and SoupX's contamination estimate.">
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Sample</th><th className="r">Mapped</th><th className="r">Uniquely mapped</th><th className="r">Cells called</th>
                <th className="r">Median UMIs</th><th className="r">Median genes</th><th className="r">Saturation</th><th className="r">Ambient ρ</th>
                {cell_qc && <><th className="r">After QC</th><th className="r">Singlets</th></>}</tr></thead>
              <tbody>
                {alignment.map((a) => {
                  const c = cell_qc?.samples.find((s) => s.sample === a.sample);
                  return (
                    <tr key={a.sample}>
                      <td><span className="chip" style={{ background: "transparent", padding: 0 }}><span className="dot" style={{ background: sampleColor(a.sample) }} /><span className="mono" style={{ color: "var(--ink)" }}>{a.sample}</span></span></td>
                      <td className="r">{fmtPct(a.mapped)}</td><td className="r">{fmtPct(a.unique)}</td>
                      <td className="r">{fmtInt(a.cells_called)}</td><td className="r">{fmtInt(a.median_umi)}</td>
                      <td className="r">{fmtInt(a.median_genes)}</td><td className="r">{fmtPct(a.saturation)}</td>
                      <td className="r">{a.contamination.toFixed(3)}</td>
                      {c && <><td className="r">{fmtInt(c.cells_after_qc)}</td><td className="r">{fmtInt(c.singlets)}</td></>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {read_qc && (
        <Panel title="Read quality" note={warn.length ? `${warn.length} sample${warn.length > 1 ? "s" : ""} flagged by FastQC. Review before trusting downstream results.` : "FastQC and MultiQC, aggregated per sample across lanes and reads."}>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Sample</th><th className="r">Reads</th><th className="r">≥ Q30</th><th className="r">Mean quality</th>
                <th className="r">GC</th><th className="r">Adapter</th><th className="r">Duplication</th><th>FastQC</th></tr></thead>
              <tbody>
                {read_qc.map((r) => (
                  <tr key={r.sample}>
                    <td className="mono">{r.sample}</td>
                    <td className="r">{fmtReads(r.total_reads)}</td><td className="r">{fmtPct(r.q30)}</td>
                    <td className="r">{r.mean_quality.toFixed(1)}</td><td className="r">{fmtPct(r.gc)}</td>
                    <td className="r">{fmtPct(r.adapter, 2)}</td><td className="r">{fmtPct(r.duplication)}</td>
                    <td><span className={`pill pill-${r.status}`}>{r.status === "pass" ? "Pass" : "Warning"}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {!alignment && <p className="muted">Alignment and cell QC results appear here as those stages finish.</p>}
    </div>
  );
}
