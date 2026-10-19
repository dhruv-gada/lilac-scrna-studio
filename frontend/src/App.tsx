import { api } from "./lib/api";
import { href, useLoad, useRoute } from "./lib/util";
import { Icon, ToastHost } from "./components/ui";
import { RunsPage } from "./pages/Runs";
import { NewRunPage } from "./pages/NewRun";
import { RunPage } from "./pages/RunDetail";
import { ReferencesPage } from "./pages/References";

export default function App() {
  const route = useRoute();
  const runs = useLoad(() => api.listRuns(), [], 4000);
  const health = useLoad(() => api.health(), []);
  const active = (runs.data ?? []).filter((r) => ["running", "queued", "needs_input"].includes(r.state));

  return (
    <div className="app">
      <aside className="sidebar">
        <a className="brand" href={href({ page: "runs" })} aria-label="Lilac scRNA Studio, all runs">
          <span className="brand-word">LILAC</span>
          <span className="brand-sub">scRNA Studio</span>
        </a>
        <nav className="nav" aria-label="Main">
          <span className="eyebrow nav-label">Workspace</span>
          <a href={href({ page: "runs" })} aria-current={route.page === "runs" || route.page === "run" ? "page" : undefined}>
            <Icon name="runs" /> Runs
          </a>
          <a href={href({ page: "new" })} aria-current={route.page === "new" ? "page" : undefined}>
            <Icon name="plus" /> New run
          </a>
          <a href={href({ page: "references" })} aria-current={route.page === "references" ? "page" : undefined}>
            <Icon name="ref" /> References
          </a>
        </nav>
        {active.length > 0 && (
          <nav className="nav nav-recent" aria-label="Active runs">
            <span className="eyebrow nav-label">In progress</span>
            {active.map((r) => (
              <a key={r.id} className="nav-run" href={href({ page: "run", id: r.id, tab: r.state === "needs_input" ? "annotation" : "pipeline" })}
                aria-current={route.page === "run" && route.id === r.id ? "page" : undefined}>
                <span>{r.name}</span>
                <span className="num muted" style={{ fontSize: "var(--t-sm)" }}>
                  {r.state === "needs_input" ? <span className="tab-badge" style={{ display: "inline-block" }} aria-label="Needs input" /> : `${Math.round(r.progress * 100)}%`}
                </span>
              </a>
            ))}
          </nav>
        )}
        <div className="sidebar-foot">
          {health.data?.demo_mode && <span className="mode-chip" title="Runs are simulated and results are synthetic">Demo data</span>}
          <span>Lilac Biosciences · Providence, RI</span>
        </div>
      </aside>
      <main className="main" id="main">
        {route.page === "runs" && <RunsPage runs={runs.data} loading={runs.loading} error={runs.error?.message} />}
        {route.page === "new" && <NewRunPage onCreated={runs.reload} />}
        {route.page === "references" && <ReferencesPage />}
        {route.page === "run" && <RunPage key={route.id} id={route.id} tab={route.tab} onChange={runs.reload} />}
      </main>
      <ToastHost />
    </div>
  );
}
