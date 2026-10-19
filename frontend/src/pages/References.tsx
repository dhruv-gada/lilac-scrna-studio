import { Panel } from "../components/ui";

const REFS = [
  { id: "GRCh38-2024-A", organism: "Human", annotation: "GENCODE v44", star: true, kallisto: true, size: "31.2 GB" },
  { id: "GRCh38-2020-A", organism: "Human", annotation: "GENCODE v32", star: true, kallisto: false, size: "29.8 GB" },
  { id: "GRCm39-2024-A", organism: "Mouse", annotation: "GENCODE vM33", star: true, kallisto: true, size: "27.4 GB" },
  { id: "mm10-2020-A", organism: "Mouse", annotation: "GENCODE vM23", star: true, kallisto: false, size: "26.1 GB" },
];

export function ReferencesPage() {
  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="page-title">References</h1>
          <p className="page-sub">Genome indexes available to runs. STARsolo needs a STAR index; kallisto needs its own index and transcript-to-gene map.</p>
        </div>
      </header>
      <Panel>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Reference</th><th>Organism</th><th>Annotation</th><th>STAR index</th><th>kallisto index</th><th className="r">Size</th></tr></thead>
            <tbody>
              {REFS.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.id}</td><td>{r.organism}</td><td>{r.annotation}</td>
                  <td>{r.star ? <span className="pill pill-done">Ready</span> : <span className="pill">Not built</span>}</td>
                  <td>{r.kallisto ? <span className="pill pill-done">Ready</span> : <span className="pill">Not built</span>}</td>
                  <td className="r">{r.size}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
