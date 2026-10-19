import { Fragment, useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import type { Catalog, Param, PipelineConfig, RunCreate, Sample, Stage, StageId } from "../lib/types";
import { go, useLoad } from "../lib/util";
import { Icon, Panel, Segmented, Skeleton, toast } from "../components/ui";

const REFERENCES = {
  human: [{ id: "GRCh38-2024-A", label: "Human GRCh38 · GENCODE v44 (2024-A)" }, { id: "GRCh38-2020-A", label: "Human GRCh38 · GENCODE v32 (2020-A)" }],
  mouse: [{ id: "GRCm39-2024-A", label: "Mouse GRCm39 · GENCODE vM33 (2024-A)" }, { id: "mm10-2020-A", label: "Mouse mm10 · GENCODE vM23 (2020-A)" }],
};

const EXAMPLE_SAMPLES: Sample[] = [
  { id: "Ctrl_1", condition: "Control", replicate: 1 },
  { id: "Ctrl_2", condition: "Control", replicate: 2 },
  { id: "Ctrl_3", condition: "Control", replicate: 3 },
  { id: "KO_1", condition: "Mettl3 KO", replicate: 1 },
  { id: "KO_2", condition: "Mettl3 KO", replicate: 2 },
  { id: "KO_3", condition: "Mettl3 KO", replicate: 3 },
];

type Step = "data" | "samples" | "pipeline" | "review";
const STEPS: { id: Step; label: string }[] = [
  { id: "data", label: "Data" }, { id: "samples", label: "Samples" },
  { id: "pipeline", label: "Pipeline" }, { id: "review", label: "Review" },
];

export function NewRunPage({ onCreated }: { onCreated: () => void }) {
  const catalog = useLoad(() => api.catalog(), []);
  const [step, setStep] = useState<Step>("data");
  const [form, setForm] = useState<RunCreate | null>(null);
  const [examples, setExamples] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!catalog.data || form) return;
    const config = structuredClone(catalog.data.standard_preset);
    config.de.params.reference = "Control";
    setForm({
      name: "", description: "", organism: "mouse", reference: "GRCm39-2024-A", input_type: "bcl",
      input_path: "", sample_sheet: "", samples: EXAMPLE_SAMPLES.map((s) => ({ ...s })), config,
    });
  }, [catalog.data, form]);

  if (!catalog.data || !form) {
    return <div className="page"><h1 className="page-title">New run</h1><Skeleton h={420} /></div>;
  }
  const cat = catalog.data;
  const set = (patch: Partial<RunCreate>) => setForm({ ...form, ...patch });
  const problems = validate(form, cat, examples);
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  async function launch() {
    if (!form) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const body = { ...form, sample_sheet: form.sample_sheet || null };
      const run = await api.createRun(body);
      onCreated();
      toast("Run started");
      go({ page: "run", id: run.id, tab: "pipeline" });
    } catch (e) {
      setServerError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">New run</h1>
          <p className="page-sub">The standard pipeline uses Seurat from cell QC through clustering, so every hand-off stays in one object.</p>
        </div>
      </header>

      <nav className="steps" aria-label="Steps">
        {STEPS.map((s, i) => (
          <button key={s.id} type="button" aria-current={s.id === step ? "step" : undefined}
            className={i < stepIndex ? "done" : undefined} onClick={() => setStep(s.id)}>
            <b>{i < stepIndex ? <Icon name="check" size={13} /> : i + 1}</b>{s.label}
          </button>
        ))}
      </nav>

      {step === "data" && <DataStep form={form} set={set} />}
      {step === "samples" && <SamplesStep form={form} set={set} examples={examples} setExamples={setExamples} />}
      {step === "pipeline" && <PipelineStep form={form} set={set} catalog={cat} />}
      {step === "review" && <ReviewStep form={form} catalog={cat} problems={problems} serverError={serverError} />}

      <div className="actions" style={{ justifyContent: "space-between" }}>
        <button type="button" className="btn" disabled={stepIndex === 0} onClick={() => setStep(STEPS[stepIndex - 1].id)}>Back</button>
        {step !== "review" ? (
          <button type="button" className="btn btn-primary" onClick={() => setStep(STEPS[stepIndex + 1].id)}>
            Continue to {STEPS[stepIndex + 1].label.toLowerCase()} <Icon name="arrow" />
          </button>
        ) : (
          <button type="button" className="btn btn-primary" disabled={problems.length > 0 || submitting} onClick={launch}>
            {submitting ? "Starting…" : "Start run"}
          </button>
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------ steps

function DataStep({ form, set }: { form: RunCreate; set: (p: Partial<RunCreate>) => void }) {
  return (
    <Panel title="Experiment and input">
      <div className="form-grid">
        <div className="field">
          <label htmlFor="run-name">Run name</label>
          <input id="run-name" className="input" value={form.name} placeholder="Cortex · Mettl3 conditional KO"
            onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div className="field">
          <label htmlFor="run-organism">Organism and reference</label>
          <div style={{ display: "flex", gap: 8 }}>
            <Segmented label="Organism" value={form.organism} onChange={(organism) =>
              set({ organism, reference: REFERENCES[organism][0].id })}
              options={[{ value: "human", label: "Human" }, { value: "mouse", label: "Mouse" }]} />
            <select id="run-organism" className="select" value={form.reference} onChange={(e) => set({ reference: e.target.value })}>
              {REFERENCES[form.organism].map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        </div>
        <div className="field span-2">
          <label htmlFor="run-desc">Description</label>
          <textarea id="run-desc" className="textarea" value={form.description}
            placeholder="What's the question? e.g. Does loss of the m6A writer shift neuronal subtype proportions?"
            onChange={(e) => set({ description: e.target.value })} />
        </div>
        <div className="field">
          <span className="field-label">Start from</span>
          <Segmented label="Input type" value={form.input_type}
            onChange={(input_type) => set({
              input_type,
              config: { ...form.config, demux: { ...form.config.demux, enabled: input_type === "bcl" } },
            })}
            options={[{ value: "bcl", label: "BCL run folder" }, { value: "fastq", label: "FASTQ files" }]} />
          <span className="hint">
            {form.input_type === "bcl" ? "BCL Convert will demultiplex it into one set of FASTQ files per sample."
              : "Demultiplexing is skipped. Files should follow Illumina naming: Sample_S1_L001_R1_001.fastq.gz."}
          </span>
        </div>
        <div className="field">
          <label htmlFor="run-path">{form.input_type === "bcl" ? "BCL run folder" : "FASTQ folder"}</label>
          <input id="run-path" className="input mono" value={form.input_path}
            placeholder={form.input_type === "bcl" ? "/data/bcl/241018_A01234_0456_BHXYZDSX7" : "/data/fastq/2410_cortex"}
            onChange={(e) => set({ input_path: e.target.value })} />
        </div>
        {form.input_type === "bcl" && (
          <div className="field span-2">
            <label htmlFor="run-sheet">Sample sheet</label>
            <input id="run-sheet" className="input mono" value={form.sample_sheet ?? ""}
              placeholder="Leave empty to use SampleSheet.csv in the run folder"
              onChange={(e) => set({ sample_sheet: e.target.value })} />
          </div>
        )}
      </div>
    </Panel>
  );
}

function SamplesStep({ form, set, examples, setExamples }: {
  form: RunCreate; set: (p: Partial<RunCreate>) => void; examples: boolean; setExamples: (b: boolean) => void;
}) {
  const [paste, setPaste] = useState("");
  const conditions = [...new Set(form.samples.map((s) => s.condition).filter(Boolean))];
  const update = (i: number, patch: Partial<Sample>) => {
    setExamples(false);
    set({ samples: form.samples.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  };
  const applyPaste = () => {
    const rows = paste.split(/\r?\n/).map((l) => l.split(/[\t,;]/).map((c) => c.trim())).filter((r) => r[0]);
    const body = rows[0] && /sample/i.test(rows[0][0]) ? rows.slice(1) : rows;
    if (!body.length) return;
    set({ samples: body.map((r, i) => ({ id: r[0], condition: r[1] ?? "", replicate: Number(r[2]) || i + 1, batch: r[3] || null })) });
    setExamples(false);
    setPaste("");
    toast(`Added ${body.length} samples`);
  };
  return (
    <div className="grid-main">
      <Panel title="Samples and conditions"
        note="Sample IDs must match the sample sheet. Each condition needs at least two biological replicates for pseudobulk testing."
        actions={examples ? <button type="button" className="btn btn-sm" onClick={() => { set({ samples: [{ id: "", condition: "", replicate: 1 }] }); setExamples(false); }}>Clear examples</button> : undefined}>
        {examples && <div className="banner banner-info" style={{ marginBottom: 12 }}><div><strong>Example rows</strong><span>Replace these with your own samples, or paste them from a spreadsheet.</span></div></div>}
        <div className="table-wrap">
          <table className="data sample-table">
            <thead><tr><th>Sample ID</th><th>Condition</th><th className="r">Replicate</th><th>Batch</th><th><span className="sr-only">Remove</span></th></tr></thead>
            <tbody>
              {form.samples.map((s, i) => (
                <tr key={i}>
                  <td><input className="input mono" aria-label={`Sample ${i + 1} ID`} id={`sample-id-${i}`} value={s.id} onChange={(e) => update(i, { id: e.target.value })} /></td>
                  <td><input className="input" aria-label={`Sample ${i + 1} condition`} id={`sample-cond-${i}`} list="conditions" value={s.condition} onChange={(e) => update(i, { condition: e.target.value })} /></td>
                  <td className="r"><input className="input num" style={{ width: 70, textAlign: "right" }} type="number" min={1} aria-label={`Sample ${i + 1} replicate`} id={`sample-rep-${i}`} value={s.replicate} onChange={(e) => update(i, { replicate: Number(e.target.value) })} /></td>
                  <td><input className="input" aria-label={`Sample ${i + 1} batch`} id={`sample-batch-${i}`} placeholder="Optional" value={s.batch ?? ""} onChange={(e) => update(i, { batch: e.target.value || null })} /></td>
                  <td className="r"><button type="button" className="btn btn-quiet btn-sm" aria-label={`Remove sample ${s.id || i + 1}`}
                    onClick={() => set({ samples: form.samples.filter((_, j) => j !== i) })}>Remove</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="conditions">{conditions.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-sm" onClick={() => set({ samples: [...form.samples, { id: "", condition: conditions[0] ?? "", replicate: form.samples.length + 1 }] })}>
            <Icon name="plus" size={14} /> Add sample
          </button>
        </div>
      </Panel>
      <Panel title="Paste from a spreadsheet" note="Columns: sample, condition, replicate, batch (optional). A header row is fine.">
        <div className="field">
          <label className="sr-only" htmlFor="paste">Rows to paste</label>
          <textarea id="paste" className="textarea mono" rows={7} value={paste} onChange={(e) => setPaste(e.target.value)}
            placeholder={"sample\tcondition\treplicate\nWT_1\tWT\t1\nWT_2\tWT\t2\nKO_1\tKO\t1"} />
          <button type="button" className="btn btn-sm" disabled={!paste.trim()} onClick={applyPaste} style={{ alignSelf: "flex-start" }}>Replace samples</button>
        </div>
      </Panel>
    </div>
  );
}

function PipelineStep({ form, set, catalog }: { form: RunCreate; set: (p: Partial<RunCreate>) => void; catalog: Catalog }) {
  const isStandard = catalog.stages.every((s) => form.config[s.id].tool === s.default_tool);
  const conditions = [...new Set(form.samples.map((s) => s.condition).filter(Boolean))];
  const setStage = (id: StageId, patch: Partial<PipelineConfig[StageId]>) =>
    set({ config: { ...form.config, [id]: { ...form.config[id], ...patch } } });
  const notes = compatNotes(form.config, catalog);

  const reset = () => {
    const c = structuredClone(catalog.standard_preset);
    c.demux.enabled = form.input_type === "bcl";
    c.de.params.reference = form.config.de.params.reference;
    set({ config: c });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div className="actions" style={{ justifyContent: "space-between" }}>
        <div className="actions">
          <span className="field-label">Preset</span>
          <span className={`tag ${isStandard ? "tag-default" : ""}`} style={{ fontSize: "var(--t-sm)", padding: "3px 8px" }}>
            {isStandard ? "Standard · Seurat throughout" : "Custom"}
          </span>
        </div>
        {!isStandard && <button type="button" className="btn btn-sm" onClick={reset}>Reset to standard</button>}
      </div>
      {notes.map((n) => (
        <div key={n.message} className={`banner ${n.level === "warning" ? "banner-warn" : "banner-info"}`}><div><span>{n.message}</span></div></div>
      ))}
      <Panel bodyClass="flush">
        <div style={{ margin: "-14px -16px -16px" }}>
          {catalog.stages.map((stage) => (
            <StageConfigCard key={stage.id} stage={stage} config={form.config[stage.id]} conditions={conditions}
              locked={stage.id === "demux" && form.input_type === "fastq"} onChange={(p) => setStage(stage.id, p)} />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function StageConfigCard({ stage, config, onChange, conditions, locked }: {
  stage: Stage; config: PipelineConfig[StageId]; onChange: (p: Partial<PipelineConfig[StageId]>) => void;
  conditions: string[]; locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const tool = stage.tools.find((t) => t.id === config.tool) ?? stage.tools[0];
  const enabled = config.enabled && !locked;
  const pickTool = (id: string) => {
    const t = stage.tools.find((x) => x.id === id)!;
    onChange({ tool: id, params: Object.fromEntries(t.params.map((p) => [p.key, p.default])) });
  };
  return (
    <div className="stage-card">
      <span className={`node ${enabled ? "done" : "skipped"}`} aria-hidden>{stage.order}</span>
      <div className="stage-card-body">
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: "var(--t-base)", fontWeight: 600 }}>{stage.name}</h3>
            <p className="muted" style={{ fontSize: "var(--t-md)" }}>{stage.goal}</p>
          </div>
          {stage.optional && (
            <label className="check">
              <input type="checkbox" id={`stage-on-${stage.id}`} checked={enabled} disabled={locked} onChange={(e) => onChange({ enabled: e.target.checked })} />
              {locked ? "Skipped for FASTQ input" : "Run this stage"}
            </label>
          )}
        </div>
        {enabled && (
          <>
            <div className="tool-options" role="radiogroup" aria-label={`Tool for ${stage.name}`}>
              {stage.tools.map((t) => (
                <button key={t.id} type="button" role="radio" className="tool-option" aria-checked={t.id === config.tool}
                  disabled={!t.available} onClick={() => pickTool(t.id)}>
                  <span className="t">
                    {t.label}
                    {t.id === stage.default_tool && <span className="tag tag-default">Standard</span>}
                    {!t.available && <span className="tag">Planned</span>}
                    <span className="tag">{t.language === "cli" ? "CLI" : t.language === "R" ? "R" : "Python"}</span>
                  </span>
                  <span className="s">{t.summary}</span>
                </button>
              ))}
            </div>
            {tool.params.length > 0 && (
              <div>
                <button type="button" className="btn btn-quiet btn-sm" aria-expanded={open} onClick={() => setOpen(!open)} style={{ marginLeft: -10 }}>
                  {open ? "Hide settings" : `Settings (${tool.params.length})`}
                </button>
                {open && (
                  <div className="params" style={{ marginTop: 8 }}>
                    {tool.params.map((p) => (
                      <ParamInput key={p.key} id={`${stage.id}-${p.key}`} param={p} value={config.params[p.key]}
                        choices={stage.id === "de" && p.key === "reference" ? conditions : undefined}
                        onChange={(v) => onChange({ params: { ...config.params, [p.key]: v } })} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ParamInput({ id, param, value, onChange, choices }: {
  id: string; param: Param; value: unknown; onChange: (v: unknown) => void; choices?: string[];
}) {
  const opts = choices ?? param.choices ?? null;
  if (param.type === "bool") {
    return <label className="check" style={{ alignSelf: "end", minHeight: 34 }}>
      <input type="checkbox" id={id} checked={Boolean(value)} onChange={(e) => onChange(e.target.checked)} />{param.label}
    </label>;
  }
  return (
    <div className="field">
      <label htmlFor={id}>{param.label}{param.unit ? ` (${param.unit})` : ""}</label>
      {opts ? (
        <select id={id} className="select" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
          {opts.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : param.type === "int" || param.type === "float" ? (
        <input id={id} className="input num" type="number" min={param.min ?? undefined} max={param.max ?? undefined}
          step={param.step ?? (param.type === "int" ? 1 : "any")} value={value == null ? "" : String(value)}
          placeholder={value == null ? "Automatic" : undefined}
          onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} />
      ) : (
        <input id={id} className="input" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />
      )}
      {param.help && <span className="hint">{param.help}</span>}
    </div>
  );
}

function ReviewStep({ form, catalog, problems, serverError }: { form: RunCreate; catalog: Catalog; problems: string[]; serverError: string | null }) {
  const conditions = useMemo(() => {
    const m = new Map<string, number>();
    form.samples.forEach((s) => m.set(s.condition, (m.get(s.condition) ?? 0) + 1));
    return [...m];
  }, [form.samples]);
  return (
    <div className="grid-main">
      <Panel title="Pipeline">
        <div className="thread" style={{ paddingBlock: 2 }}>
          {catalog.stages.map((s) => {
            const c = form.config[s.id];
            const t = s.tools.find((x) => x.id === c.tool);
            const on = c.enabled && !(s.id === "demux" && form.input_type === "fastq");
            return (
              <div key={s.id} className="thread-stage" style={{ cursor: "default" }}>
                <span className={`node ${on ? "done" : "skipped"}`}>{s.order}</span>
                <div className="thread-text"><span className="thread-name">{s.name}</span>
                  <span className="thread-tool">{on ? t?.label : "Skipped"}</span></div>
                <span />
              </div>
            );
          })}
        </div>
      </Panel>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {(problems.length > 0 || serverError) && (
          <div className="banner banner-bad">
            <div>
              <strong>Fix before starting</strong>
              {serverError && <span>{serverError}</span>}
              {problems.map((p) => <span key={p}>{p}</span>)}
            </div>
          </div>
        )}
        <Panel title={form.name || "Untitled run"}>
          <dl className="kv">
            <dt>Reference</dt><dd>{form.reference}</dd>
            <dt>Input</dt><dd className="mono">{form.input_path || "—"}</dd>
            <dt>Samples</dt><dd>{form.samples.length}</dd>
            {conditions.map(([c, n]) => (
              <Fragment key={c}>
                <dt>{c || "No condition"}</dt>
                <dd>{n} replicate{n === 1 ? "" : "s"}{c === form.config.de.params.reference ? " · reference" : ""}</dd>
              </Fragment>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------ checks

function validate(form: RunCreate, catalog: Catalog, examples: boolean): string[] {
  const out: string[] = [];
  if (!form.name.trim()) out.push("Give the run a name.");
  if (!form.input_path.trim()) out.push(`Add the ${form.input_type === "bcl" ? "BCL run folder" : "FASTQ folder"} path.`);
  if (examples) out.push("Replace the example samples with your own.");
  const ids = form.samples.map((s) => s.id.trim());
  if (ids.some((i) => !i)) out.push("Every sample needs an ID.");
  if (new Set(ids).size !== ids.length) out.push("Sample IDs must be unique.");
  const conds = new Map<string, number>();
  form.samples.forEach((s) => conds.set(s.condition.trim(), (conds.get(s.condition.trim()) ?? 0) + 1));
  if (conds.has("")) out.push("Every sample needs a condition.");
  if (conds.size < 2) out.push("Add at least two conditions to compare.");
  for (const [c, n] of conds) if (c && n < 2) out.push(`“${c}” has one sample. Add a second replicate.`);
  if (!conds.has(String(form.config.de.params.reference))) out.push("Pick a reference condition under Differential expression settings.");
  for (const s of catalog.stages) {
    const t = s.tools.find((x) => x.id === form.config[s.id].tool);
    if (form.config[s.id].enabled && t && !t.available) out.push(`${t.label} isn't available for ${s.name.toLowerCase()} yet.`);
  }
  return out;
}

function compatNotes(config: PipelineConfig, catalog: Catalog) {
  const notes: { level: "info" | "warning"; message: string }[] = [];
  if (config.ambient.enabled && config.ambient.tool === "cellbender")
    notes.push({ level: "info", message: "CellBender calls cells itself, so it replaces the cell calls from alignment. Alignment still provides the raw matrix." });
  const langs = new Set((["cell_qc", "normalize", "cluster"] as StageId[]).map((id) =>
    catalog.stages.find((s) => s.id === id)!.tools.find((t) => t.id === config[id].tool)?.language));
  if (langs.has("R") && langs.has("python"))
    notes.push({ level: "warning", message: "This run mixes Seurat and Scanpy, so objects are converted at each hand-off." });
  if (config.annotate.tool === "seurat_markers")
    notes.push({ level: "info", message: "Manual annotation pauses the run after clustering so you can name clusters before differential expression." });
  return notes;
}
