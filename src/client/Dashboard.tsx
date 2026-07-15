import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleUserRound,
  Clock3,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { AppUser, Appointment, BootstrapResponse, FixedSlot } from "../shared/contracts";
import { api, ApiError } from "./api";
import { ConfirmDialog, CreateDialog, EditDialog } from "./Dialogs";

function formatDateLong(date: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatDateShort(date: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatTime(start: string, end: string): string {
  return `${start} – ${end}`;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function slotKey(slot: FixedSlot): string {
  return `${slot.startTime}-${slot.endTime}`;
}

interface ConfirmState {
  title: string;
  message: string;
  destructive?: boolean;
  action: () => Promise<void>;
}

function AppointmentCard({
  appointment,
  users,
  currentUser,
  busy,
  onAssign,
  onEdit,
  onDelete,
}: {
  appointment: Appointment;
  users: AppUser[];
  currentUser: AppUser;
  busy: boolean;
  onAssign: (appointment: Appointment, assigneeId: string | null) => void;
  onEdit: (appointment: Appointment) => void;
  onDelete: (appointment: Appointment) => void;
}) {
  const assignee = users.find((user) => user.id === appointment.assigneeId);
  const mine = appointment.assigneeId === currentUser.id;
  const stateClass = mine ? "is-mine" : assignee ? "is-assigned" : "is-free";

  return (
    <article className={`appointment-card ${stateClass} ${busy ? "is-busy" : ""}`}>
      <div className="appointment-card__topline">
        <div className="appointment-card__status">
          <span className="status-dot" />
          {mine ? "Mein Termin" : assignee ? "Zugewiesen" : "Noch frei"}
        </div>
        <div className="card-actions">
          <button className="icon-button icon-button--small" type="button" disabled={busy} onClick={() => onEdit(appointment)} aria-label={`${appointment.name} bearbeiten`} title="Bearbeiten"><Pencil size={14} /></button>
          <button className="icon-button icon-button--small icon-button--danger" type="button" disabled={busy} onClick={() => onDelete(appointment)} aria-label={`${appointment.name} löschen`} title="Löschen"><Trash2 size={14} /></button>
        </div>
      </div>
      <h3 title={appointment.name}>{appointment.name}</h3>
      <div className="assignment-row">
        <label className={`assignment-select ${assignee ? "has-assignee" : "is-unassigned"}`} title="Person zuweisen">
          <span className="assignment-select__avatar">{assignee ? initials(assignee.displayName) : <CircleUserRound size={17} />}</span>
          <span className="assignment-select__copy"><small>Zuständig</small><strong>{assignee?.displayName ?? "Nicht zugewiesen"}</strong></span>
          <ChevronDown className="assignment-select__chevron" size={15} />
          <select disabled={busy} value={appointment.assigneeId ?? ""} onChange={(event) => onAssign(appointment, event.target.value || null)} aria-label={`Person für ${appointment.name} auswählen`}>
            <option value="">Nicht zugewiesen</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.displayName}{user.id === currentUser.id ? " (ich)" : ""}</option>)}
          </select>
        </label>
        {!assignee && <button className="quick-self-assign" type="button" disabled={busy} onClick={() => onAssign(appointment, currentUser.id)} title="Mir zuweisen" aria-label={`${appointment.name} mir zuweisen`}>{busy ? <LoaderCircle className="spin" size={15} /> : <UserCheck size={16} />}<span>Ich</span></button>}
      </div>
    </article>
  );
}

export function Dashboard({ sessionUser, onLoggedOut }: { sessionUser: AppUser; onLoggedOut: () => void }) {
  const [data, setData] = useState<BootstrapResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);

  const showToast = (message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const next = await api.bootstrap();
      setData(next);
      setSelectedDate((current) =>
        current === next.dates.today || current === next.dates.nextWorkday
          ? current
          : next.dates.today,
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return onLoggedOut();
      showToast(caught instanceof Error ? caught.message : "Termine konnten nicht geladen werden.", "error");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [onLoggedOut]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(true), 30_000);
    const onVisibility = () => document.visibilityState === "visible" && void load(true);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  const selectedAppointments = useMemo(
    () => data?.appointments.filter((appointment) => appointment.date === selectedDate) ?? [],
    [data?.appointments, selectedDate],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const fixedKeys = new Set(data.fixedSlots.map(slotKey));
    const custom = new Map<string, FixedSlot>();
    for (const appointment of selectedAppointments) {
      const slot = { startTime: appointment.startTime, endTime: appointment.endTime };
      if (!fixedKeys.has(slotKey(slot))) custom.set(slotKey(slot), slot);
    }
    return [...data.fixedSlots, ...custom.values()].sort(
      (a, b) => a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime),
    );
  }, [data, selectedAppointments]);

  const markBusy = (id: string, value: boolean) =>
    setBusyIds((current) => {
      const next = new Set(current);
      if (value) next.add(id); else next.delete(id);
      return next;
    });

  const mutate = async (appointment: Appointment, operation: () => Promise<unknown>, success: string) => {
    markBusy(appointment.id, true);
    try {
      await operation();
      await load(true);
      showToast(success);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        await load(true);
        showToast("Der Termin wurde bereits verändert. Die Ansicht ist jetzt aktuell.", "error");
      } else if (caught instanceof ApiError && caught.status === 401) {
        onLoggedOut();
      } else {
        showToast(caught instanceof Error ? caught.message : "Änderung fehlgeschlagen.", "error");
      }
      throw caught;
    } finally {
      markBusy(appointment.id, false);
    }
  };

  const assign = (appointment: Appointment, assigneeId: string | null) => {
    if (appointment.assigneeId === assigneeId) return;
    const action = () => mutate(
      appointment,
      () => api.updateAppointment(appointment.id, { version: appointment.version, assigneeId }),
      assigneeId ? "Zuweisung gespeichert." : "Zuweisung aufgehoben.",
    );
    if (appointment.assigneeId && assigneeId === null) {
      setConfirm({ title: "Zuweisung aufheben?", message: `„${appointment.name}“ ist danach wieder frei.`, action });
    } else {
      void action().catch(() => undefined);
    }
  };

  const remove = (appointment: Appointment) => setConfirm({
    title: "Termin löschen?",
    message: `„${appointment.name}“ wird endgültig aus der aktuellen Planung entfernt.`,
    destructive: true,
    action: () => mutate(appointment, () => api.deleteAppointment(appointment.id, appointment.version), "Termin gelöscht."),
  });

  const runConfirmed = async () => {
    if (!confirm) return;
    setConfirmBusy(true);
    try {
      await confirm.action();
      setConfirm(null);
    } catch {
      // Die eigentliche Aktion zeigt bereits eine verständliche Meldung.
    } finally {
      setConfirmBusy(false);
    }
  };

  const logout = async () => {
    try { await api.logout(); } finally { onLoggedOut(); }
  };

  if (loading || !data) {
    return <main className="loading-screen"><LoaderCircle className="spin" size={24} /><span>Terminübersicht wird vorbereitet …</span></main>;
  }

  const mine = selectedAppointments.filter((appointment) => appointment.assigneeId === data.currentUser.id).length;
  const free = selectedAppointments.filter((appointment) => !appointment.assigneeId).length;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup brand-lockup--light">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
          <div><strong>Rollout</strong><small>Planer</small></div>
        </div>
        <nav className="sidebar-nav" aria-label="Hauptnavigation">
          <span className="sidebar-nav__label">Arbeitsbereich</span>
          <button className="sidebar-nav__item is-active" type="button"><LayoutDashboard size={18} />Terminübersicht</button>
        </nav>
        <section className="sidebar-planning" aria-label="Tag auswählen">
          <span className="sidebar-nav__label">Planungstag</span>
          <button className={selectedDate === data.dates.today ? "sidebar-day is-active" : "sidebar-day"} type="button" onClick={() => setSelectedDate(data.dates.today)}>
            <span className="sidebar-day__icon"><CalendarDays size={17} /></span><span><small>Heute</small><strong>{formatDateShort(data.dates.today)}</strong></span>{selectedDate === data.dates.today && <Check size={14} />}
          </button>
          <button className={selectedDate === data.dates.nextWorkday ? "sidebar-day is-active" : "sidebar-day"} type="button" onClick={() => setSelectedDate(data.dates.nextWorkday)}>
            <span className="sidebar-day__icon"><CalendarDays size={17} /></span><span><small>Nächster Arbeitstag</small><strong>{formatDateShort(data.dates.nextWorkday)}</strong></span>{selectedDate === data.dates.nextWorkday && <Check size={14} />}
          </button>
          <div className="sidebar-stats" aria-label="Kennzahlen des ausgewählten Tages">
            <div><strong>{selectedAppointments.length}</strong><span>Termine</span></div><div><strong>{free}</strong><span>Noch frei</span></div><div><strong>{mine}</strong><span>Meine</span></div>
          </div>
        </section>
        <div className="sidebar-user">
          <span className="avatar">{initials(data.currentUser.displayName)}</span>
          <div><strong>{data.currentUser.displayName}</strong><span>{data.currentUser.source === "dev" ? "Entwicklungszugang" : data.currentUser.username}</span></div>
          <button className="icon-button icon-button--on-dark" type="button" onClick={logout} aria-label="Abmelden" title="Abmelden"><LogOut size={17} /></button>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div><p className="eyebrow">Windows 11 Rollout</p><h1>Terminübersicht</h1></div>
          <div className="workspace-header__actions">
            <button className="icon-button refresh-button" type="button" onClick={() => void load(true)} disabled={refreshing} aria-label="Ansicht aktualisieren" title="Aktualisieren"><RefreshCw className={refreshing ? "spin" : ""} size={17} /></button>
            <button className="button button--primary button--create" type="button" onClick={() => setCreateOpen(true)}><Plus size={18} />Termine erstellen</button>
          </div>
        </header>

        <section
          className={rows.length > 4 ? "schedule schedule--dense" : rows.length === 4 ? "schedule schedule--four" : "schedule"}
          aria-label={`Termine für ${formatDateShort(selectedDate)}`}
        >
          <div className="schedule-heading"><div><h2>{formatDateLong(selectedDate)}</h2><span>{selectedAppointments.length === 0 ? "Noch keine Termine angelegt" : `${selectedAppointments.length} ${selectedAppointments.length === 1 ? "Termin" : "Termine"} geplant`}</span></div><div className="legend"><span><i className="legend-dot legend-dot--free" />Frei</span><span><i className="legend-dot legend-dot--mine" />Mein Termin</span><span><i className="legend-dot legend-dot--assigned" />Zugewiesen</span></div></div>
          <div className="schedule-rows" style={{ "--row-count": rows.length } as CSSProperties}>
            {rows.map((row) => {
              const appointments = selectedAppointments.filter((appointment) => appointment.startTime === row.startTime && appointment.endTime === row.endTime);
              const isCustom = !data.fixedSlots.some((slot) => slotKey(slot) === slotKey(row));
              return (
                <section className="time-row" key={slotKey(row)}>
                  <div className="time-row__label"><span className="time-row__icon"><Clock3 size={18} /></span><strong>{formatTime(row.startTime, row.endTime)}</strong><small>{isCustom ? "Eigene Uhrzeit" : `${appointments.length} ${appointments.length === 1 ? "Termin" : "Termine"}`}</small></div>
                  <div className={appointments.length ? "appointment-grid" : "appointment-grid appointment-grid--empty"}>
                    {appointments.length ? appointments.map((appointment) => (
                      <AppointmentCard key={appointment.id} appointment={appointment} users={data.users} currentUser={data.currentUser} busy={busyIds.has(appointment.id)} onAssign={assign} onEdit={setEditing} onDelete={remove} />
                    )) : <button className="empty-slot" type="button" onClick={() => setCreateOpen(true)}><Plus size={17} /><span><strong>Noch keine Termine</strong><small>Jetzt hinzufügen</small></span></button>}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      </main>

      {createOpen && <CreateDialog initialDate={selectedDate} dates={data.dates} fixedSlots={data.fixedSlots} maximum={data.limits.maxAppointmentsPerSlot} onClose={() => setCreateOpen(false)} onCreate={async (payload) => { await api.createAppointments(payload); await load(true); setCreateOpen(false); showToast("Termine wurden erstellt."); }} />}
      {editing && <EditDialog appointment={editing} users={data.users} onClose={() => setEditing(null)} onSave={async (payload) => { await mutate(editing, () => api.updateAppointment(editing.id, payload), "Termin gespeichert."); setEditing(null); }} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} destructive={confirm.destructive} busy={confirmBusy} onCancel={() => setConfirm(null)} onConfirm={() => void runConfirmed()} />}
      {toast && <div className={`toast toast--${toast.tone}`} role="status">{toast.tone === "success" ? <Check size={17} /> : <X size={17} />}{toast.message}</div>}
    </div>
  );
}
