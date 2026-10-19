import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// ---------------------------------------------------------------- formatting

const nf = new Intl.NumberFormat("en-US");
export const fmtInt = (n: number) => nf.format(Math.round(n));
export const fmtPct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;
export function fmtReads(n: number) {
  return n >= 1e9 ? `${(n / 1e9).toFixed(2)} B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} M` : fmtInt(n);
}
export function fmtP(p: number) {
  if (p === 0) return "< 1e-300";
  if (p >= 0.001) return p.toFixed(3);
  const [m, e] = p.toExponential(1).split("e");
  return `${m} × 10${superscript(e)}`;
}
const SUP: Record<string, string> = { "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "" };
const superscript = (s: string) => s.split("").map((c) => SUP[c] ?? c).join("");

export function fmtWhen(iso: string) {
  const d = new Date(iso);
  const mins = (Date.now() - d.getTime()) / 60000;
  if (mins < 1) return "Just now";
  if (mins < 60) return `${Math.round(mins)} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
export function fmtDuration(a: string | null, b: string | null) {
  if (!a) return "";
  const ms = (b ? new Date(b) : new Date()).getTime() - new Date(a).getTime();
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`;
}

// ---------------------------------------------------------------- routing (hash based)

export type Route =
  | { page: "runs" }
  | { page: "new" }
  | { page: "references" }
  | { page: "run"; id: string; tab: RunTab };
export type RunTab = "pipeline" | "quality" | "clusters" | "annotation" | "de";
const TABS: RunTab[] = ["pipeline", "quality", "clusters", "annotation", "de"];

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts[0] === "new") return { page: "new" };
  if (parts[0] === "references") return { page: "references" };
  if (parts[0] === "runs" && parts[1]) {
    const tab = (TABS as string[]).includes(parts[2]) ? (parts[2] as RunTab) : "pipeline";
    return { page: "run", id: decodeURIComponent(parts[1]), tab };
  }
  return { page: "runs" };
}

export function href(r: Route) {
  switch (r.page) {
    case "runs": return "#/";
    case "new": return "#/new";
    case "references": return "#/references";
    case "run": return `#/runs/${encodeURIComponent(r.id)}/${r.tab}`;
  }
}

const subscribe = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parse(hash);
}
export const go = (r: Route) => { window.location.hash = href(r); };

// ---------------------------------------------------------------- data loading

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[], pollMs?: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<{ status?: number; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    try {
      const v = await fnRef.current();
      setData(v);
      setError(null);
    } catch (e) {
      const err = e as { status?: number; message?: string };
      setError({ status: err.status, message: err.message ?? "Something went wrong." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setData(null);
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!pollMs) return;
    const t = setInterval(reload, pollMs);
    return () => clearInterval(t);
  }, [pollMs, reload]);

  return { data, error, loading, reload, setData };
}

// ---------------------------------------------------------------- theme tokens for canvas drawing

function readTokens() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name: string) => cs.getPropertyValue(name).trim();
  return {
    bg: v("--surface"), fg: v("--ink"), muted: v("--ink-2"), faint: v("--ink-3"), line: v("--line"),
    grid: v("--grid"), accent: v("--accent"), bad: v("--bad"), up: v("--up"), down: v("--down"), ns: v("--ns"),
    seq: [v("--seq-0"), v("--seq-1"), v("--seq-2")],
    cat: Array.from({ length: 12 }, (_, i) => v(`--cat-${i}`)),
    cond: [v("--cond-0"), v("--cond-1"), v("--cond-2"), v("--cond-3")],
    dark: matchMedia("(prefers-color-scheme: dark)").matches
      ? document.documentElement.dataset.theme !== "light"
      : document.documentElement.dataset.theme === "dark",
  };
}
export type Tokens = ReturnType<typeof readTokens>;

export function useTokens(): Tokens {
  const [t, setT] = useState(readTokens);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setT(readTokens());
    mq.addEventListener("change", update);
    const mo = new MutationObserver(update);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { mq.removeEventListener("change", update); mo.disconnect(); };
  }, []);
  return t;
}

export function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => {
      const r = e.contentRect;
      setSize({ w: Math.round(r.width), h: Math.round(r.height) });
    });
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

// Interpolate along the sequential ramp (three stops) for feature plots.
export function ramp(stops: string[], t: number) {
  const parse = (c: string) => {
    const m = c.replace("#", "");
    return [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  };
  const seg = t < 0.5 ? 0 : 1;
  const local = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  const a = parse(stops[seg]), b = parse(stops[seg + 1]);
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * local)).join(",")})`;
}

export function withAlpha(hex: string, a: number) {
  const m = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}
