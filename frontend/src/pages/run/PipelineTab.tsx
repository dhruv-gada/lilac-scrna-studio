import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import type { StageId } from "../../lib/types";
import { fmtDuration, useLoad } from "../../lib/util";
import { Panel, stageStateLabel } from "../../components/ui";
import type { RunCtx } from "../RunDetail";

export function PipelineTab({ ctx }: { ctx: RunCtx }) {
  const { run, stages } = ctx;
  const current = run.stages.find((s) => ["running", "needs_input", "failed"].includes(s.state))?.id;
  const [selected, setSelected] = useState<StageId>(current ?? "de");
  const followRef = useRef(true);
  useEffect(() => { if (followRef.current && current) setSelected(current); }, [current]);

  // Thread fill: node to node through finished stages, then the running stage's progress.
  const n = stages.length - 1;
  const idx = run.stages.findIndex((s) => s.state === "running" || s.state === "needs_input" || s.state === "failed");
  const lastDone = run.stages.reduce((a, s, i) => (s.state === "done" || s.state === "skipped" ? i : a), 0);
  const frac = run.state === "done" ? 1
    : idx >= 0 ? Math.max(0, idx - 1 + (run.stages[idx].state === "running" ? run.stages[idx].progress : 1)) / n
    : lastDone / n;

  const st = run.stages.find((s) => s.id === selected)!;
  const def = stages.find((s) => s.id === selected)!;
  const cfg = run.config[selected];
  const tool = def.tools.find((t) => t.id === cfg.tool);
  const logs = useLoad(() => api.logs(run.id, selected), [run.id, selected], st.state === "running" ? 1200 : undefined);
  const logRef = useRef<HTMLPreElement>(null);
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [logs.data]);

  return (
    <div className="grid-main" style={{ gridTemplateColumns: "minmax(0, 380px) minmax(0, 1fr)" }}>
      <Panel title="Stages" note={`${run.stages.filter((s) => s.state === "done").length} of ${run.stages.filter((s) => s.state !== "skipped").length} complete`}>
        <div className="thread" role="list">
          <span className="thread-track" aria-hidden />
          <span className="thread-fill" aria-hidden style={{ height: `calc((100% - 44px) * ${Math.min(frac, 1)})` }} />
          {stages.map((s) => {
            const status = run.stages.find((x) => x.id === s.id)!;
            const c = run.config[s.id];
            const toolLabel = s.tools.find((t) => t.id === c.tool)?.label;
            return (
              <button key={s.id} type="button" role="listitem" className="thread-stage" aria-current={selected === s.id}
                onClick={() => { followRef.current = false; setSelected(s.id); }}>
                <span className={`node ${status.state}`}>{s.order}</span>
                <span className="thread-text">
                  <span className="thread-name">{s.name}</span>
                  <span className="thread-tool">{status.state === "skipped" ? "Skipped" : toolLabel}</span>
                </span>
                <span className="thread-meta">
                  {status.state === "running" ? `${Math.round(status.progress * 100)}%`
                    : status.state === "done" ? fmtDuration(status.started_at, status.finished_at)
                    : status.state === "pending" ? "" : stageStateLabel(status.state)}
                </span>
                {status.state === "running" && <span className="bar"><span style={{ width: `${status.progress * 100}%` }} /></span>}
              </button>
            );
          })}
        </div>
      </Panel>

      <div style={{ display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
        <Panel title={<>Stage {def.order} · {def.name}</>} note={def.goal}
          actions={<span className={`pill pill-${st.state === "pending" ? "draft" : st.state === "skipped" ? "draft" : st.state}`}>{stageStateLabel(st.state)}</span>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {st.state === "failed" && <div className="banner banner-bad"><div><strong>What went wrong</strong><span>{st.message}</span></div></div>}
            {st.state === "needs_input" && <div className="banner banner-warn"><div><strong>Waiting for you</strong><span>{st.message}. Open Annotation to name each cluster.</span></div></div>}
            <dl className="kv">
              <dt>Tool</dt><dd>{cfg.enabled ? tool?.label : "Skipped"}{tool && cfg.enabled ? <span className="muted"> · {tool.summary}</span> : null}</dd>
              <dt>Input</dt><dd>{def.inputs.join(", ")}</dd>
              <dt>Output</dt><dd>{def.outputs.join(", ")}</dd>
              {st.started_at && <><dt>Duration</dt><dd className="num">{fmtDuration(st.started_at, st.finished_at)}{st.state === "running" ? " so far" : ""}</dd></>}
              {cfg.enabled && tool?.params.map((p) => (
                <FragmentKV key={p.key} k={`${p.label}${p.unit ? ` (${p.unit})` : ""}`}
                  v={cfg.params[p.key] == null ? "Automatic" : typeof cfg.params[p.key] === "boolean" ? (cfg.params[p.key] ? "On" : "Off") : typeof cfg.params[p.key] === "number" ? (cfg.params[p.key] as number).toLocaleString("en-US") : String(cfg.params[p.key])} />
              ))}
            </dl>
          </div>
        </Panel>
        <Panel title="Log" note={st.state === "running" ? "Updates live" : undefined}>
          {logs.data && logs.data.length ? (
            <pre className="log" ref={logRef}>
              {logs.data.map((l, i) => <div key={i} className={/^ERROR/.test(l) ? "err" : undefined}>{l}</div>)}
            </pre>
          ) : <p className="muted">{st.state === "pending" ? "This stage hasn't started." : st.state === "skipped" ? "This stage was skipped." : "No output yet."}</p>}
        </Panel>
      </div>
    </div>
  );
}

function FragmentKV({ k, v }: { k: string; v: string }) {
  return <><dt>{k}</dt><dd>{v}</dd></>;
}
