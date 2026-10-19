import { useEffect, useState, type ReactNode } from "react";
import type { RunState, StageState, StageStatus } from "../lib/types";

// ---------------------------------------------------------------- icons (one 1.6px stroke family)

const paths: Record<string, ReactNode> = {
  runs: <><rect x="3" y="4" width="14" height="4" rx="1.5" /><rect x="3" y="12" width="14" height="4" rx="1.5" /></>,
  plus: <path d="M10 4v12M4 10h12" />,
  ref: <><path d="M6 3c0 4 8 4 8 7s-8 3-8 7" /><path d="M14 3c0 4-8 4-8 7s8 3 8 7" /><path d="M7.5 6h5M7.5 14h5" /></>,
  back: <path d="M12 4l-6 6 6 6" />,
  retry: <><path d="M4 10a6 6 0 1 0 2-4.5" /><path d="M4 3v3.5h3.5" /></>,
  stop: <rect x="5" y="5" width="10" height="10" rx="2" />,
  check: <path d="M4 10.5l4 4 8-9" />,
  alert: <><path d="M10 3l8 14H2z" /><path d="M10 8v4M10 14.5v.5" /></>,
  search: <><circle cx="9" cy="9" r="5" /><path d="M13 13l4 4" /></>,
  download: <><path d="M10 3v10M5.5 8.5L10 13l4.5-4.5" /><path d="M4 17h12" /></>,
  arrow: <path d="M4 10h12M11 5l5 5-5 5" />,
  info: <><circle cx="10" cy="10" r="7" /><path d="M10 9v5M10 6.5v.5" /></>,
};

export function Icon({ name, size = 16, label }: { name: keyof typeof paths | string; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" role={label ? "img" : undefined}
      aria-label={label} aria-hidden={label ? undefined : true}>
      {paths[name]}
    </svg>
  );
}

// ---------------------------------------------------------------- status

const RUN_LABEL: Record<RunState, string> = {
  draft: "Draft", queued: "Queued", running: "Running", needs_input: "Needs your input",
  done: "Complete", failed: "Failed", cancelled: "Cancelled",
};
const STAGE_LABEL: Record<StageState, string> = {
  pending: "Waiting", running: "Running", needs_input: "Needs your input", done: "Done",
  failed: "Failed", skipped: "Skipped",
};

export function StatusPill({ state }: { state: RunState }) {
  return <span className={`pill pill-${state}`}>{RUN_LABEL[state]}</span>;
}
export const stageStateLabel = (s: StageState) => STAGE_LABEL[s];

export function MiniThread({ stages }: { stages: Pick<StageStatus, "id" | "state">[] }) {
  return (
    <div className="mini-thread" role="img"
      aria-label={`${stages.filter((s) => s.state === "done").length} of ${stages.filter((s) => s.state !== "skipped").length} stages done`}>
      {stages.map((s, i) => (
        <i key={s.id} className={s.state}
          style={s.state === "done" ? { backgroundPosition: `${(i / 9) * 100}% 0` } : undefined} />
      ))}
    </div>
  );
}

export function Segmented<T extends string>({
  value, options, onChange, label,
}: { value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} disabled={o.disabled}
          onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Panel({ title, note, actions, children, bodyClass }: {
  title?: ReactNode; note?: ReactNode; actions?: ReactNode; children: ReactNode; bodyClass?: string;
}) {
  return (
    <section className="panel">
      {(title || actions) && (
        <div className="panel-head">
          <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
            {title && <h2 className="panel-title">{title}</h2>}
            {note && <p className="panel-note">{note}</p>}
          </div>
          {actions && <div className="actions">{actions}</div>}
        </div>
      )}
      <div className={`panel-body ${bodyClass ?? ""}`}>{children}</div>
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children && <p style={{ maxWidth: "52ch" }}>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ h = 240 }: { h?: number }) {
  return <div className="skeleton" style={{ height: h }} aria-label="Loading" />;
}

let toastSet: ((s: string | null) => void) | null = null;
export function toast(message: string) { toastSet?.(message); }
export function ToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { toastSet = setMsg; return () => { toastSet = null; }; }, []);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2600);
    return () => clearTimeout(t);
  }, [msg]);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

export function Swatch({ color }: { color: string }) {
  return <span className="dot" style={{ background: color }} />;
}
