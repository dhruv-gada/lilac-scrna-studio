import { useEffect, useMemo, useRef, useState } from "react";
import type { DEGene, Density } from "../lib/types";
import { fmtInt, fmtP, ramp, useSize, useTokens, withAlpha, type Tokens } from "../lib/util";

function setupCanvas(canvas: HTMLCanvasElement, w: number, h: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

// =============================================================== UMAP

export interface UmapProps {
  x: number[];
  y: number[];
  /** Categorical: index into `colors` per point. */
  group?: number[];
  colors?: string[];
  visible?: Set<number>;
  /** Continuous 0–100 values per point (feature plot). */
  values?: number[];
  labels?: { text: string; x: number; y: number; color: string }[];
  describe: (i: number) => string;
  ariaLabel: string;
  height?: number;
}

export function Umap({ x, y, group, colors, visible, values, labels, describe, ariaLabel, height }: UmapProps) {
  const [wrap, size] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const t = useTokens();
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const h = height ?? Math.max(320, Math.min(620, Math.round(size.w * 0.78)));

  const geom = useMemo(() => {
    if (!size.w || !x.length) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < x.length; i++) {
      if (x[i] < x0) x0 = x[i]; if (x[i] > x1) x1 = x[i];
      if (y[i] < y0) y0 = y[i]; if (y[i] > y1) y1 = y[i];
    }
    const pad = 28;
    const s = Math.min((size.w - pad * 2) / (x1 - x0), (h - pad * 2) / (y1 - y0));
    const ox = (size.w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
    const px = new Float32Array(x.length), py = new Float32Array(x.length);
    for (let i = 0; i < x.length; i++) {
      px[i] = ox + (x[i] - x0) * s;
      py[i] = h - (oy + (y[i] - y0) * s);
    }
    const toScreen = (vx: number, vy: number) => [ox + (vx - x0) * s, h - (oy + (vy - y0) * s)];
    // Spatial hash for hover.
    const cell = 12, cols = Math.ceil(size.w / cell) + 1;
    const grid = new Map<number, number[]>();
    for (let i = 0; i < x.length; i++) {
      const k = Math.floor(py[i] / cell) * cols + Math.floor(px[i] / cell);
      (grid.get(k) ?? grid.set(k, []).get(k)!).push(i);
    }
    return { px, py, toScreen, grid, cell, cols };
  }, [x, y, size.w, h]);

  useEffect(() => {
    if (!geom || !canvas.current) return;
    const ctx = setupCanvas(canvas.current, size.w, h);
    const r = x.length > 20000 ? 1.1 : x.length > 8000 ? 1.4 : 1.8;
    const order = values ? [...values.keys()].sort((a, b) => values[a] - values[b]) : [...x.keys()];
    const dim = withAlpha(t.ns.startsWith("#") ? t.ns : "#cccccc", t.dark ? 0.5 : 0.55);
    // Dimmed points first so the selection draws on top.
    if (visible && group) {
      ctx.fillStyle = dim;
      for (const i of order) if (!visible.has(group[i])) { ctx.beginPath(); ctx.arc(geom.px[i], geom.py[i], r, 0, 6.283); ctx.fill(); }
    }
    for (const i of order) {
      if (visible && group && !visible.has(group[i])) continue;
      ctx.fillStyle = values ? ramp(t.seq, values[i] / 100) : (colors?.[group?.[i] ?? 0] ?? t.accent);
      ctx.globalAlpha = values ? 0.95 : 0.82;
      ctx.beginPath(); ctx.arc(geom.px[i], geom.py[i], r, 0, 6.283); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Publication-style axis arrows bottom-left.
    ctx.strokeStyle = t.muted; ctx.fillStyle = t.muted; ctx.lineWidth = 1.2;
    const ax = 18, ay = h - 20, L = 40;
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + L, ay); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - L); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ax + L + 4, ay); ctx.lineTo(ax + L - 2, ay - 3); ctx.lineTo(ax + L - 2, ay + 3); ctx.fill();
    ctx.beginPath(); ctx.moveTo(ax, ay - L - 4); ctx.lineTo(ax - 3, ay - L + 2); ctx.lineTo(ax + 3, ay - L + 2); ctx.fill();
    ctx.font = "600 10px " + getComputedStyle(document.body).fontFamily;
    ctx.fillText("UMAP 1", ax, ay + 13);
    ctx.save(); ctx.translate(ax - 6, ay); ctx.rotate(-Math.PI / 2); ctx.fillText("UMAP 2", 0, 0); ctx.restore();
    // Cluster labels with a halo so they read over points.
    if (labels) {
      ctx.font = "600 12px " + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const l of labels) {
        const [lx, ly] = geom.toScreen(l.x, l.y);
        ctx.lineWidth = 3.5; ctx.strokeStyle = t.bg; ctx.strokeText(l.text, lx, ly);
        ctx.fillStyle = t.fg; ctx.fillText(l.text, lx, ly);
      }
      ctx.textAlign = "start"; ctx.textBaseline = "alphabetic";
    }
  }, [geom, colors, group, values, visible, labels, t, size.w, h, x]);

  const onMove = (e: React.PointerEvent) => {
    if (!geom) return;
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const cx = Math.floor(mx / geom.cell), cy = Math.floor(my / geom.cell);
    let best = -1, bd = 64;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const i of geom.grid.get((cy + dy) * geom.cols + cx + dx) ?? []) {
        const d = (geom.px[i] - mx) ** 2 + (geom.py[i] - my) ** 2;
        if (d < bd) { bd = d; best = i; }
      }
    }
    setTip(best >= 0 ? { x: geom.px[best], y: geom.py[best], text: describe(best) } : null);
  };

  return (
    <div className="plot" ref={wrap}>
      <canvas ref={canvas} role="img" aria-label={ariaLabel} onPointerMove={onMove} onPointerLeave={() => setTip(null)} />
      {tip && <div className="plot-tip" style={{ left: Math.min(tip.x + 12, size.w - 180), top: tip.y + 12 }}>{tip.text}</div>}
    </div>
  );
}

// =============================================================== Volcano

export function Volcano({ genes, padj, lfc, selected, onSelect, test, reference }: {
  genes: DEGene[]; padj: number; lfc: number; selected?: string | null; onSelect?: (g: string) => void;
  test: string; reference: string;
}) {
  const [wrap, size] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const t = useTokens();
  const [tip, setTip] = useState<{ x: number; y: number; g: DEGene } | null>(null);
  const h = Math.max(300, Math.min(460, Math.round(size.w * 0.62)));
  const m = { l: 52, r: 16, t: 26, b: 44 };

  const scale = useMemo(() => {
    const ys = genes.map((g) => -Math.log10(Math.max(g.padj, 1e-300)));
    // Cap the y axis at ~1.15× the 90th percentile of significant genes so a few extreme
    // p-values don't flatten everything else; capped genes draw as triangles on the top edge.
    const sigY = ys.filter((_, i) => genes[i].padj < 0.05).sort((a, b) => a - b);
    const maxY = Math.max(...ys);
    const q = sigY[Math.floor(sigY.length * 0.9)] ?? maxY;
    const yCap = Math.max(10, Math.min(Math.ceil(maxY * 1.05), Math.ceil((q * 1.15) / 5) * 5));
    let xMax = Math.max(2, Math.ceil(Math.max(...genes.map((g) => Math.abs(g.log2fc))) + 0.25));
    if (xMax > 6 && xMax % 2) xMax += 1;
    const W = size.w - m.l - m.r, Hh = h - m.t - m.b;
    const sx = (v: number) => m.l + ((v + xMax) / (2 * xMax)) * W;
    const sy = (v: number) => m.t + Hh - (Math.min(v, yCap) / yCap) * Hh;
    return { ys, yCap, xMax, sx, sy, W, Hh };
  }, [genes, size.w, h]);

  const cls = (g: DEGene) => (g.padj < padj && g.log2fc >= lfc ? "up" : g.padj < padj && g.log2fc <= -lfc ? "down" : "ns");

  useEffect(() => {
    if (!size.w || !canvas.current) return;
    const ctx = setupCanvas(canvas.current, size.w, h);
    const { sx, sy, yCap, xMax, ys } = scale;
    const font = getComputedStyle(document.body).fontFamily;
    // Grid + ticks
    ctx.strokeStyle = t.grid; ctx.lineWidth = 1; ctx.fillStyle = t.muted; ctx.font = `11px ${font}`;
    ctx.textAlign = "center";
    const xStep = xMax > 6 ? 2 : 1;
    for (let v = -xMax; v <= xMax; v += xStep) {
      ctx.beginPath(); ctx.moveTo(sx(v), m.t); ctx.lineTo(sx(v), h - m.b); ctx.stroke();
      ctx.fillText(String(v), sx(v), h - m.b + 16);
    }
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const yStep = yCap > 40 ? 10 : yCap > 16 ? 5 : 2;
    const capped = ys.some((v) => v > yCap);
    let lastTick = 0;
    for (let v = 0; v <= yCap; v += yStep) {
      ctx.beginPath(); ctx.moveTo(m.l, sy(v)); ctx.lineTo(size.w - m.r, sy(v)); ctx.stroke();
      ctx.fillText(capped && v === yCap ? `≥ ${v}` : String(v), m.l - 8, sy(v));
      lastTick = v;
    }
    if (capped && lastTick !== yCap) ctx.fillText(`≥ ${yCap}`, m.l - 8, sy(yCap));
    ctx.textBaseline = "alphabetic"; ctx.textAlign = "center";
    ctx.fillStyle = t.muted; ctx.font = `600 11px ${font}`;
    ctx.fillText(`log₂ fold change (${test} vs ${reference})`, m.l + scale.W / 2, h - 8);
    ctx.save(); ctx.translate(14, m.t + scale.Hh / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText("−log₁₀ adjusted p", 0, 0); ctx.restore();
    // Cutoffs
    ctx.setLineDash([4, 4]); ctx.strokeStyle = t.faint;
    const yc = -Math.log10(padj);
    ctx.beginPath(); ctx.moveTo(m.l, sy(yc)); ctx.lineTo(size.w - m.r, sy(yc));
    ctx.moveTo(sx(-lfc), m.t); ctx.lineTo(sx(-lfc), h - m.b); ctx.moveTo(sx(lfc), m.t); ctx.lineTo(sx(lfc), h - m.b);
    ctx.stroke(); ctx.setLineDash([]);
    // Points: not significant first.
    const order = genes.map((_, i) => i).sort((a, b) => (cls(genes[a]) === "ns" ? -1 : 0) - (cls(genes[b]) === "ns" ? -1 : 0));
    for (const i of order) {
      const g = genes[i], c = cls(g);
      ctx.fillStyle = c === "up" ? t.up : c === "down" ? t.down : t.ns;
      ctx.globalAlpha = c === "ns" ? 0.7 : 0.85;
      const capped = ys[i] > yCap;
      ctx.beginPath();
      if (capped) { const X = sx(g.log2fc), Y = sy(yCap); ctx.moveTo(X, Y - 4); ctx.lineTo(X - 3.5, Y + 2.5); ctx.lineTo(X + 3.5, Y + 2.5); }
      else ctx.arc(sx(g.log2fc), sy(ys[i]), c === "ns" ? 2 : 2.8, 0, 6.283);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Labels for the top hits each side, plus the selected gene.
    const sig = genes.filter((g) => cls(g) !== "ns");
    const top = [...sig.filter((g) => g.log2fc > 0).slice(0, 6), ...sig.filter((g) => g.log2fc < 0).slice(0, 4)];
    const sel = selected ? genes.find((g) => g.gene === selected) : undefined;
    if (sel && !top.includes(sel)) top.push(sel);
    ctx.font = `600 11px ${font}`; ctx.textBaseline = "middle";
    const placed: { x0: number; x1: number; y: number }[] = [];
    for (const g of top) {
      const X = sx(g.log2fc), Y = sy(Math.min(-Math.log10(Math.max(g.padj, 1e-300)), yCap));
      const w = ctx.measureText(g.gene).width;
      const right = g.log2fc < 0 ? X - w - 10 < m.l : X + w + 10 < size.w - m.r;
      const lx = right ? X + 7 : X - 7 - w;
      let ly = Math.max(m.t + 6, Y);
      while (placed.some((p) => Math.abs(p.y - ly) < 13 && lx < p.x1 + 4 && lx + w > p.x0 - 4)) ly += 13;
      placed.push({ x0: lx, x1: lx + w, y: ly });
      if (Math.abs(ly - Y) > 6) {
        ctx.strokeStyle = t.faint; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(X, Y); ctx.lineTo(right ? lx - 2 : lx + w + 2, ly); ctx.stroke();
      }
      if (g === sel) {
        ctx.strokeStyle = t.fg; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(X, Y, 5.5, 0, 6.283); ctx.stroke();
      }
      ctx.lineWidth = 3; ctx.strokeStyle = t.bg; ctx.textAlign = "left";
      ctx.strokeText(g.gene, lx, ly); ctx.fillStyle = t.fg; ctx.fillText(g.gene, lx, ly);
    }
    ctx.textBaseline = "alphabetic";
  }, [genes, scale, padj, lfc, selected, t, size.w, h, test, reference]);

  const onMove = (e: React.PointerEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best: DEGene | null = null, bd = 80;
    genes.forEach((g, i) => {
      const d = (scale.sx(g.log2fc) - mx) ** 2 + (scale.sy(scale.ys[i]) - my) ** 2;
      if (d < bd) { bd = d; best = g; }
    });
    setTip(best ? { x: mx, y: my, g: best } : null);
  };

  return (
    <div className="plot" ref={wrap}>
      <canvas ref={canvas} role="img"
        aria-label={`Volcano plot of ${genes.length} genes. ${genes.filter((g) => cls(g) === "up").length} up and ${genes.filter((g) => cls(g) === "down").length} down in ${test} at adjusted p below ${padj} and absolute log2 fold change of at least ${lfc}.`}
        onPointerMove={onMove} onPointerLeave={() => setTip(null)}
        onClick={() => tip && onSelect?.(tip.g.gene)} style={{ cursor: tip ? "pointer" : "default" }} />
      {tip && (
        <div className="plot-tip" style={{ left: Math.min(tip.x + 12, size.w - 190), top: tip.y + 12 }}>
          <b className="mono">{tip.g.gene}</b><br />
          log₂FC {tip.g.log2fc.toFixed(2)} · p<sub>adj</sub> {fmtP(tip.g.padj)}
        </div>
      )}
    </div>
  );
}

// =============================================================== Heatmap

export function Heatmap({ rows, samples, conditions, condColors, reference }: {
  rows: { gene: string; values: number[] }[]; samples: string[]; conditions: string[];
  condColors: Record<string, string>; reference: string;
}) {
  const t = useTokens();
  const geneW = 78, cell = 26, band = 10, headH = 92;
  const order = samples.map((_, i) => i).sort((a, b) =>
    (conditions[a] === reference ? 0 : 1) - (conditions[b] === reference ? 0 : 1));
  const W = geneW + samples.length * cell + 64;
  const H = headH + band + 6 + rows.length * cell + 30;
  const color = (z: number) => {
    const v = Math.max(-2, Math.min(2, z)) / 2;
    return v >= 0 ? mix(t.bg, t.up, v) : mix(t.bg, t.down, -v);
  };
  return (
    <div className="table-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, maxWidth: "100%", height: "auto" }} role="img"
        aria-label={`Heatmap of the top ${rows.length} genes, z-scored per gene across ${samples.length} pseudobulk samples`}>
        {order.map((si, c) => (
          <g key={samples[si]}>
            <text x={geneW + c * cell + cell / 2} y={headH - 4} fontSize="10" fill={t.muted}
              transform={`rotate(-55 ${geneW + c * cell + cell / 2} ${headH - 4})`}>{samples[si]}</text>
            <rect x={geneW + c * cell + 1} y={headH} width={cell - 2} height={band} rx="2" fill={condColors[conditions[si]]} />
          </g>
        ))}
        {rows.map((r, ri) => (
          <g key={r.gene}>
            <text x={geneW - 8} y={headH + band + 6 + ri * cell + cell / 2 + 4} textAnchor="end" fontSize="11"
              fontFamily="var(--font-mono)" fill={t.fg}>{r.gene}</text>
            {order.map((si, c) => (
              <rect key={si} x={geneW + c * cell + 1} y={headH + band + 6 + ri * cell + 1} width={cell - 2} height={cell - 2}
                rx="2" fill={color(r.values[si])}><title>{`${r.gene} · ${samples[si]}: z = ${r.values[si].toFixed(2)}`}</title></rect>
            ))}
          </g>
        ))}
        <g transform={`translate(${geneW} ${H - 18})`}>
          {[-2, -1, 0, 1, 2].map((z, i) => (
            <g key={z}>
              <rect x={i * 22} y="0" width="20" height="8" rx="2" fill={color(z)} stroke={t.line} />
              <text x={i * 22 + 10} y="18" fontSize="9" textAnchor="middle" fill={t.muted}>{z}</text>
            </g>
          ))}
          <text x={5 * 22 + 6} y="8" fontSize="10" fill={t.muted}>z-score</text>
        </g>
      </svg>
    </div>
  );
}

function mix(a: string, b: string, k: number) {
  const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  if (!a.startsWith("#") || !b.startsWith("#")) return b;
  const A = p(a), B = p(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(",")})`;
}

// =============================================================== Violin

export function Violins({ samples, metric, unit, log, thresholds, colors }: {
  samples: { sample: string; d: Density }[]; metric: string; unit?: string; log?: boolean;
  thresholds?: { value: number; label: string }[]; colors: string[];
}) {
  const t = useTokens();
  const [wrap, size] = useSize<HTMLDivElement>();
  const W = Math.max(280, size.w), H = 236, m = { l: 46, r: 8, t: 10, b: 66 };
  const lo = samples[0]?.d.lo ?? 0, hi = samples[0]?.d.hi ?? 1;
  const sy = (v: number) => m.t + (H - m.t - m.b) * (1 - (v - lo) / (hi - lo));
  const colW = (W - m.l - m.r) / Math.max(1, samples.length);
  const ticks = log ? [2, 3, 4, 5].filter((v) => v >= lo && v <= hi) : [0, 10, 20, 30, 40, 50].filter((v) => v >= lo && v <= hi);
  const tickLabel = (v: number) => (log ? (v >= 3 ? `${10 ** (v - 3)}k` : `${10 ** v}`) : `${v}`);
  return (
    <div ref={wrap}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: H }} role="img"
        aria-label={`${metric} per cell, distribution for each sample`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={W - m.r} y1={sy(v)} y2={sy(v)} stroke={t.grid} />
            <text x={m.l - 6} y={sy(v) + 4} fontSize="10" textAnchor="end" fill={t.muted}>{tickLabel(v)}</text>
          </g>
        ))}
        {samples.map((s, i) => {
          const cx = m.l + colW * (i + 0.5), half = colW * 0.38, n = s.d.density.length;
          const pts = s.d.density.map((dv, k) => [half * dv, sy(lo + ((k + 0.5) / n) * (hi - lo))]);
          const path = `M${pts.map(([dx, y]) => `${cx + dx},${y}`).join("L")}L${[...pts].reverse().map(([dx, y]) => `${cx - dx},${y}`).join("L")}Z`;
          return (
            <g key={s.sample}>
              <path d={path} fill={withAlpha(colors[i % colors.length], 0.28)} stroke={colors[i % colors.length]} strokeWidth="1.2" />
              <line x1={cx - half * 0.5} x2={cx + half * 0.5} y1={sy(s.d.median)} y2={sy(s.d.median)} stroke={t.fg} strokeWidth="2" />
              <text x={cx} y={H - m.b + 12} fontSize="10" textAnchor="end" fill={t.muted}
                transform={`rotate(-35 ${cx} ${H - m.b + 12})`}>{s.sample}</text>
            </g>
          );
        })}
        {thresholds?.map((th) => (
          <g key={th.label}>
            <line x1={m.l} x2={W - m.r} y1={sy(th.value)} y2={sy(th.value)} stroke={t.bad} strokeDasharray="5 4" strokeWidth="1.3" />
            <text x={W - m.r} y={sy(th.value) - 4} fontSize="10" textAnchor="end" fill={t.bad} fontWeight="600"
              stroke={t.bg} strokeWidth="3" paintOrder="stroke">{th.label}</text>
          </g>
        ))}
        <text x={m.l} y={H - 6} fontSize="10" fill={t.muted} fontWeight="600">{metric}{unit ? ` (${unit})` : ""}</text>
      </svg>
    </div>
  );
}

// =============================================================== Dot plot

export function DotPlot({ genes, clusters, dots, colors }: {
  genes: string[]; clusters: { id: string; label: string }[];
  dots: { cluster: string; gene: string; avg: number; pct: number }[]; colors: string[];
}) {
  const t = useTokens();
  const labelW = 132, cell = 24, headH = 64;
  const W = labelW + genes.length * cell + 10, H = headH + clusters.length * cell + 36;
  const get = new Map(dots.map((d) => [`${d.cluster}|${d.gene}`, d]));
  const maxAvg = Math.max(...dots.map((d) => d.avg), 1);
  return (
    <div className="table-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: W, maxWidth: "100%", height: "auto" }} role="img"
        aria-label="Dot plot of marker genes by cluster: dot size is the percent of cells expressing, color is average expression">
        {genes.map((g, gi) => (
          <text key={g} x={labelW + gi * cell + cell / 2} y={headH - 6} fontSize="10" fontFamily="var(--font-mono)" fill={t.fg}
            transform={`rotate(-55 ${labelW + gi * cell + cell / 2} ${headH - 6})`}>{g}</text>
        ))}
        {clusters.map((c, ci) => (
          <g key={c.id}>
            <rect x={4} y={headH + ci * cell + 7} width="10" height="10" rx="2" fill={colors[ci % colors.length]} />
            <text x={20} y={headH + ci * cell + 16} fontSize="11" fill={t.fg}>{c.label.length > 17 ? c.label.slice(0, 16) + "…" : c.label}</text>
            {genes.map((g, gi) => {
              const d = get.get(`${c.id}|${g}`);
              if (!d) return null;
              return (
                <circle key={g} cx={labelW + gi * cell + cell / 2} cy={headH + ci * cell + cell / 2}
                  r={Math.max(1.2, Math.sqrt(d.pct / 100) * (cell / 2 - 1.5))} fill={ramp(t.seq, Math.min(1, d.avg / maxAvg))}>
                  <title>{`${g} in ${c.label}: ${d.pct}% of cells, average ${d.avg}`}</title>
                </circle>
              );
            })}
          </g>
        ))}
        <g transform={`translate(${labelW} ${H - 22})`}>
          {[25, 50, 75, 100].map((p, i) => (
            <g key={p}>
              <circle cx={i * 34 + 8} cy="6" r={Math.sqrt(p / 100) * (cell / 2 - 1.5)} fill={t.muted} />
              <text x={i * 34 + 8} y="22" fontSize="9" textAnchor="middle" fill={t.muted}>{p}%</text>
            </g>
          ))}
          <rect x={150} y="2" width="70" height="8" rx="4" fill="url(#dp-ramp)" />
          <defs><linearGradient id="dp-ramp"><stop offset="0" stopColor={t.seq[0]} /><stop offset="0.5" stopColor={t.seq[1]} /><stop offset="1" stopColor={t.seq[2]} /></linearGradient></defs>
          <text x={150} y="22" fontSize="9" fill={t.muted}>low</text>
          <text x={220} y="22" fontSize="9" textAnchor="end" fill={t.muted}>high</text>
        </g>
      </svg>
    </div>
  );
}

// =============================================================== Funnel

export function Funnel({ steps }: { steps: { step: string; cells: number }[] }) {
  const max = steps[0]?.cells || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {steps.map((s, i) => (
        <div key={s.step} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: "4px 12px", alignItems: "baseline" }}>
          <span style={{ fontSize: "var(--t-md)" }}>{s.step}</span>
          <span className="num" style={{ fontWeight: 600 }}>
            {fmtInt(s.cells)}
            {i > 0 && <span className="muted" style={{ fontWeight: 400, marginLeft: 6 }}>
              {`−${(((steps[i - 1].cells - s.cells) / steps[i - 1].cells) * 100).toFixed(1)}%`}
            </span>}
          </span>
          <div style={{ gridColumn: "1 / -1", height: 8, borderRadius: 4, background: "var(--sunken)", overflow: "hidden" }}>
            <div style={{ width: `${(s.cells / max) * 100}%`, height: "100%", borderRadius: 4, background: "var(--thread-x)", backgroundSize: `${(max / s.cells) * 100}% 100%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export type { Tokens };
