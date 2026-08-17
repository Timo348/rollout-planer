import {
  Check,
  Clipboard,
  ExternalLink,
  Gauge,
  LoaderCircle,
  Plus,
  Save,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  CreatePublicDashboardInput,
  PublicDashboardSettings,
  UpdatePublicDashboardInput,
} from "../shared/contracts";
import { api } from "./api";
import { ConfirmDialog } from "./Dialogs";

type DashboardDraft = Omit<PublicDashboardSettings, "createdAt" | "updatedAt">;

function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function newDraft(index: number): DashboardDraft {
  return {
    id: "",
    name: `Dashboard ${index}`,
    slug: `dashboard-${index}`,
    title: "Öffentliche Terminübersicht",
    subtitle: "",
    isDefault: false,
    isEnabled: true,
    appointmentScope: "all",
    trendDays: 7,
    showAppointmentNames: false,
    showAssigneeNames: false,
    showQuickOverview: true,
    showPodium: false,
    showPreparationStatus: true,
    refreshSeconds: 60,
    defaultTheme: "light",
    zoomPercent: 100,
  };
}

export function PublicDashboardAdmin({
  onClose,
  onUnauthorized,
}: {
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const [dashboards, setDashboards] = useState<PublicDashboardSettings[]>([]);
  const [draft, setDraft] = useState<DashboardDraft | null>(null);
  const [creating, setCreating] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState<PublicDashboardSettings | null>(null);

  const load = useCallback(async (selectId?: string) => {
    try {
      const result = await api.getPublicDashboards();
      setDashboards(result.dashboards);
      const selected = result.dashboards.find((entry) => entry.id === selectId)
        ?? result.dashboards[0]
        ?? null;
      if (selected) {
        const { createdAt: _createdAt, updatedAt: _updatedAt, ...nextDraft } = selected;
        setDraft(nextDraft);
      }
      setCreating(false);
      setError("");
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) onUnauthorized();
      setError(caught instanceof Error ? caught.message : "Dashboards konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  useEffect(() => { void load(); }, [load]);

  const selectDashboard = (dashboard: PublicDashboardSettings) => {
    const { createdAt: _createdAt, updatedAt: _updatedAt, ...nextDraft } = dashboard;
    setDraft(nextDraft);
    setCreating(false);
    setSlugEdited(false);
    setError("");
    setMessage("");
  };

  const beginCreate = () => {
    const next = newDraft(dashboards.length + 1);
    setDraft(next);
    setCreating(true);
    setSlugEdited(false);
    setError("");
    setMessage("");
  };

  const update = <K extends keyof DashboardDraft>(key: K, value: DashboardDraft[K]) => {
    setDraft((current) => current ? { ...current, [key]: value } : current);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (creating) {
        const { id: _id, isDefault: _isDefault, ...payload } = draft;
        const result = await api.createPublicDashboard(payload as CreatePublicDashboardInput);
        await load(result.dashboard.id);
        setMessage("Dashboard wurde erstellt.");
      } else {
        const { id, slug: _slug, ...payload } = draft;
        const result = await api.updatePublicDashboard(id, payload as UpdatePublicDashboardInput);
        await load(result.dashboard.id);
        setMessage("Dashboard wurde gespeichert.");
      }
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) onUnauthorized();
      setError(caught instanceof Error ? caught.message : "Das Dashboard konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    setError("");
    try {
      await api.deletePublicDashboard(pendingDelete.id);
      setPendingDelete(null);
      await load();
      setMessage("Dashboard wurde gelöscht.");
    } catch (caught) {
      if ((caught as { status?: number }).status === 401) onUnauthorized();
      setPendingDelete(null);
      setError(caught instanceof Error ? caught.message : "Das Dashboard konnte nicht gelöscht werden.");
    } finally {
      setBusy(false);
    }
  };

  const publicUrl = useMemo(
    () => draft ? `${window.location.origin}/public/${draft.slug}` : "",
    [draft],
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setMessage("Öffentlicher Link wurde kopiert.");
    } catch {
      setError("Der Link konnte nicht automatisch kopiert werden.");
    }
  };

  return (
    <>
      <div className="modal-backdrop">
        <section className="modal modal--dashboard-admin" role="dialog" aria-modal="true" aria-labelledby="dashboard-admin-title">
          <header className="modal__header">
            <div><p className="eyebrow">Öffentliche Ansichten</p><h2 id="dashboard-admin-title">Dashboards</h2></div>
            <button className="icon-button" type="button" onClick={onClose} aria-label="Schließen"><X size={18} /></button>
          </header>
          <div className="dashboard-admin">
            <aside className="dashboard-admin__list">
              <button className="button button--primary" type="button" onClick={beginCreate}><Plus size={16} />Dashboard erstellen</button>
              {loading ? <div className="dashboard-admin__loading"><LoaderCircle className="spin" size={18} />Wird geladen …</div> : dashboards.map((dashboard) => (
                <button
                  className={!creating && draft?.id === dashboard.id ? "dashboard-list-item is-active" : "dashboard-list-item"}
                  type="button"
                  key={dashboard.id}
                  onClick={() => selectDashboard(dashboard)}
                >
                  <span><strong>{dashboard.name}</strong><small>/public/{dashboard.slug}</small></span>
                  <span className="dashboard-list-item__badges">
                    {dashboard.isDefault && <Star size={13} aria-label="Standard" />}
                    <i className={dashboard.isEnabled ? "is-enabled" : ""} title={dashboard.isEnabled ? "Aktiv" : "Deaktiviert"} />
                  </span>
                </button>
              ))}
            </aside>

            <div className="dashboard-admin__editor">
              {draft ? (
                <form onSubmit={(event) => void save(event)}>
                  <div className="dashboard-editor__heading">
                    <div><Gauge size={20} /><span><strong>{creating ? "Neues Dashboard" : draft.name}</strong><small>Alle Einstellungen gelten nur für diese Ansicht.</small></span></div>
                    {!creating && (
                      <div className="dashboard-editor__links">
                        <button className="icon-button icon-button--small" type="button" onClick={() => void copyLink()} aria-label="Link kopieren" title="Link kopieren"><Clipboard size={14} /></button>
                        <a className="icon-button icon-button--small" href={publicUrl} target="_blank" rel="noreferrer" aria-label="Dashboard öffnen" title="Dashboard öffnen"><ExternalLink size={14} /></a>
                      </div>
                    )}
                  </div>

                  {error && <div className="alert alert--error" role="alert">{error}</div>}
                  {message && <div className="alert alert--success" role="status"><Check size={15} />{message}</div>}

                  <div className="dashboard-form-grid">
                    <label className="field">Interner Name<input value={draft.name} maxLength={80} required onChange={(event) => {
                      const name = event.target.value;
                      update("name", name);
                      if (creating && !slugEdited) update("slug", slugify(name));
                    }} /></label>
                    <label className="field">Kurzlink<input value={draft.slug} maxLength={60} required disabled={!creating} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" onChange={(event) => { setSlugEdited(true); update("slug", slugify(event.target.value)); }} /></label>
                    <label className="field dashboard-field--wide">Öffentlicher Titel<input value={draft.title} maxLength={100} required onChange={(event) => update("title", event.target.value)} /></label>
                    <label className="field dashboard-field--wide">Untertitel<textarea value={draft.subtitle} maxLength={240} rows={2} onChange={(event) => update("subtitle", event.target.value)} /></label>
                    <label className="field">Terminansicht<select value={draft.appointmentScope} onChange={(event) => update("appointmentScope", event.target.value as DashboardDraft["appointmentScope"])}><option value="all">Alle Planungstage</option><option value="today">Nur heute</option><option value="today_tomorrow">Heute und morgen</option></select></label>
                    <label className="field">Tagestrend<select value={draft.trendDays} onChange={(event) => update("trendDays", Number(event.target.value) as DashboardDraft["trendDays"])}><option value={7}>7 Tage</option><option value={30}>30 Tage</option></select></label>
                    <label className="field">Aktualisierung<select value={draft.refreshSeconds} onChange={(event) => update("refreshSeconds", Number(event.target.value) as DashboardDraft["refreshSeconds"])}><option value={0}>Aus</option><option value={30}>30 Sekunden</option><option value={60}>60 Sekunden</option><option value={120}>120 Sekunden</option></select></label>
                    <label className="field">Standardmodus<select value={draft.defaultTheme} onChange={(event) => update("defaultTheme", event.target.value as DashboardDraft["defaultTheme"])}><option value="light">Hell</option><option value="dark">Dunkel</option></select></label>
                    <label className="field">Zoom<select value={draft.zoomPercent} onChange={(event) => update("zoomPercent", Number(event.target.value) as DashboardDraft["zoomPercent"])}>{[50, 75, 100, 125, 150, 175, 200, 225, 250].map((value) => <option value={value} key={value}>{value} %</option>)}</select></label>
                  </div>

                  <div className="dashboard-switches">
                    <label><input type="checkbox" checked={draft.isEnabled} onChange={(event) => update("isEnabled", event.target.checked)} /><span>Öffentlich aktiv<small>Der Kurzlink ist ohne Anmeldung erreichbar.</small></span></label>
                    <label><input type="checkbox" checked={draft.showAppointmentNames} onChange={(event) => update("showAppointmentNames", event.target.checked)} /><span>Termin-/Organisationsnamen zeigen<small>Standardmäßig aus Datenschutzgründen verborgen.</small></span></label>
                    <label><input type="checkbox" checked={draft.showAssigneeNames} onChange={(event) => update("showAssigneeNames", event.target.checked)} /><span>Namen zugewiesener Personen zeigen<small>Sonst wird nur der Zuweisungsstatus angezeigt.</small></span></label>
                    <label><input type="checkbox" checked={draft.showQuickOverview} onChange={(event) => update("showQuickOverview", event.target.checked)} /><span>Quick-Übersicht zeigen<small>Kennzahlen für heute und den Trendzeitraum.</small></span></label>
                    <label><input type="checkbox" checked={draft.showPodium} onChange={(event) => update("showPodium", event.target.checked)} /><span>Podium zeigen<small>Zeigt nur die Profilbilder der Top 3 aus den letzten 14 Tagen.</small></span></label>
                    <label><input type="checkbox" checked={draft.showPreparationStatus} onChange={(event) => update("showPreparationStatus", event.target.checked)} /><span>Vorbereitungsstatus zeigen<small>Zeigt vorbereitet beziehungsweise offen.</small></span></label>
                    {!creating && <label><input type="checkbox" checked={draft.isDefault} disabled={draft.isDefault} onChange={(event) => update("isDefault", event.target.checked)} /><span>Als Standard verwenden<small>Dieses Dashboard erscheint direkt unter /public.</small></span></label>}
                  </div>

                  <footer className="dashboard-editor__footer">
                    {!creating && <button className="button button--ghost dashboard-delete" type="button" disabled={busy || draft.isDefault || dashboards.length <= 1} onClick={() => setPendingDelete(dashboards.find((entry) => entry.id === draft.id) ?? null)}><Trash2 size={16} />Löschen</button>}
                    <button className="button button--primary" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{creating ? "Erstellen" : "Speichern"}</button>
                  </footer>
                </form>
              ) : <div className="dashboard-admin__empty">Kein Dashboard ausgewählt.</div>}
            </div>
          </div>
        </section>
      </div>
      {pendingDelete && <ConfirmDialog title="Dashboard löschen?" message={`„${pendingDelete.name}“ und sein öffentlicher Link werden dauerhaft entfernt.`} destructive busy={busy} onCancel={() => setPendingDelete(null)} onConfirm={() => void remove()} />}
    </>
  );
}
