import {
  CalendarDays,
  Camera,
  Check,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Crown,
  ImagePlus,
  LayoutDashboard,
  LoaderCircle,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  UserCheck,
  UserRoundX,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties } from "react";
import { createPortal } from "react-dom";
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

function formatWeekday(date: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatDayMonth(date: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatMonth(month: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${month}-01T12:00:00Z`));
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

function avatarUrl(user: AppUser): string | null {
  if (!user.avatar) return null;
  return `/api/users/${encodeURIComponent(user.id)}/avatar?v=${encodeURIComponent(user.avatar.updatedAt)}`;
}

function UserAvatar({ user, className }: { user: AppUser; className: string }) {
  const source = avatarUrl(user);
  return (
    <span className={className} aria-hidden="true">
      {source ? <img src={source} alt="" /> : initials(user.displayName)}
    </span>
  );
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
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState<CSSProperties>({ top: 0, left: 0, width: 270 });

  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const appShell = document.querySelector<HTMLElement>(".app-shell");
    const measuredScale = appShell && appShell.clientWidth > 0
      ? appShell.getBoundingClientRect().width / appShell.clientWidth
      : 1;
    const scale = Number.isFinite(measuredScale) ? Math.max(1, measuredScale) : 1;
    const width = Math.min(286, (window.innerWidth - 24) / scale);
    const visualWidth = width * scale;
    const estimatedHeight = Math.min(292, 54 + (users.length + 1) * 50) * scale;
    const gap = 6 * scale;
    const roomBelow = window.innerHeight - rect.bottom - 12;
    const top = roomBelow >= estimatedHeight
      ? rect.bottom + gap
      : Math.max(12, rect.top - estimatedHeight - gap);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - visualWidth - 12));
    setMenuPosition({ top, left, width, transform: `scale(${scale})`, transformOrigin: "top left" });
  }, [users.length]);

  useEffect(() => {
    if (!menuOpen) return;
    positionMenu();
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        triggerRef.current?.focus();
      }
    };
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen, positionMenu]);

  useEffect(() => {
    if (busy) setMenuOpen(false);
  }, [busy]);

  const selectAssignee = (assigneeId: string | null) => {
    setMenuOpen(false);
    onAssign(appointment, assigneeId);
  };

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
        <button
          ref={triggerRef}
          className={`assignment-select ${assignee ? "has-assignee" : "is-unassigned"} ${menuOpen ? "is-open" : ""}`}
          type="button"
          disabled={busy}
          title="Person zuweisen"
          aria-haspopup="listbox"
          aria-expanded={menuOpen}
          aria-label={`Person für ${appointment.name} auswählen`}
          onClick={() => {
            if (!menuOpen) positionMenu();
            setMenuOpen((current) => !current);
          }}
        >
          {assignee
            ? <UserAvatar user={assignee} className="assignment-select__avatar" />
            : <span className="assignment-select__avatar"><CircleUserRound size={17} /></span>}
          <span className="assignment-select__copy"><small>Zuständig</small><strong>{assignee?.displayName ?? "Nicht zugewiesen"}</strong></span>
          <ChevronDown className="assignment-select__chevron" size={15} />
        </button>
        {!assignee && <button className="quick-self-assign" type="button" disabled={busy} onClick={() => onAssign(appointment, currentUser.id)} title="Mir zuweisen" aria-label={`${appointment.name} mir zuweisen`}>{busy ? <LoaderCircle className="spin" size={15} /> : <UserCheck size={16} />}<span>Ich</span></button>}
      </div>
      {menuOpen && createPortal(
        <div
          ref={menuRef}
          className="assignment-menu"
          style={menuPosition}
          role="listbox"
          aria-label={`Zuständigkeit für ${appointment.name}`}
        >
          <div className="assignment-menu__heading"><span>Zuständigkeit</span><small>Person auswählen</small></div>
          <button
            className={`assignment-menu__option assignment-menu__option--free ${!assignee ? "is-selected" : ""}`}
            type="button"
            role="option"
            aria-selected={!assignee}
            onClick={() => selectAssignee(null)}
          >
            <span className="assignment-menu__avatar assignment-menu__avatar--free"><CircleUserRound size={18} /></span>
            <span className="assignment-menu__copy"><strong>Nicht zugewiesen</strong><small>Termin bleibt für das Team frei</small></span>
            {!assignee && <Check size={16} />}
          </button>
          <div className="assignment-menu__divider" />
          {users.map((user) => {
            const selected = user.id === appointment.assigneeId;
            return (
              <button
                className={`assignment-menu__option ${selected ? "is-selected" : ""}`}
                type="button"
                role="option"
                aria-selected={selected}
                key={user.id}
                onClick={() => selectAssignee(user.id)}
              >
                <UserAvatar user={user} className="assignment-menu__avatar" />
                <span className="assignment-menu__copy"><strong>{user.displayName}</strong><small>{user.id === currentUser.id ? "Ich" : user.username}</small></span>
                {selected && <Check size={16} />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </article>
  );
}

export function Dashboard({ sessionUser, onLoggedOut }: { sessionUser: AppUser; onLoggedOut: () => void }) {
  const [data, setData] = useState<BootstrapResponse | null>(null);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createInitialSlotKey, setCreateInitialSlotKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<Appointment | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const profileButtonRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileInputRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3500);
  };

  const openCreateDialog = (initialSlotKey: string | null = null) => {
    setCreateInitialSlotKey(initialSlotKey);
    setCreateOpen(true);
  };

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const next = await api.bootstrap();
      setData(next);
      setSelectedDate((current) =>
        next.dates.planningDays.includes(current)
          ? current
          : next.dates.planningDays[0]!,
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

  useEffect(() => {
    if (!profileOpen) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!profileButtonRef.current?.contains(target) && !profileMenuRef.current?.contains(target)) setProfileOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProfileOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [profileOpen]);

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

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      showToast("Bitte ein JPEG-, PNG- oder WebP-Bild auswählen.", "error");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast("Das Profilbild darf maximal 20 MB groß sein.", "error");
      return;
    }
    setProfileBusy(true);
    try {
      await api.uploadAvatar(file);
      await load(true);
      setProfileOpen(false);
      showToast("Profilbild gespeichert.");
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "Profilbild konnte nicht gespeichert werden.", "error");
    } finally {
      setProfileBusy(false);
    }
  };

  const askRemoveAvatar = () => {
    setProfileOpen(false);
    setConfirm({
      title: "Profilbild entfernen?",
      message: "Danach werden wieder deine Initialen angezeigt.",
      destructive: true,
      action: async () => {
        await api.deleteAvatar();
        await load(true);
        showToast("Profilbild entfernt.");
      },
    });
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
          <span className="sidebar-nav__label">Planungstage</span>
          <div className="sidebar-days">
            {data.dates.planningDays.map((date) => (
              <button className={selectedDate === date ? "sidebar-day is-active" : "sidebar-day"} type="button" key={date} onClick={() => setSelectedDate(date)}>
                <span className="sidebar-day__icon"><CalendarDays size={15} /></span>
                <span><small>{date === data.dates.today ? "Heute" : formatWeekday(date)}</small><strong>{formatDayMonth(date)}</strong></span>
                {selectedDate === date && <Check size={13} />}
              </button>
            ))}
          </div>
          <div className="sidebar-stats" aria-label="Kennzahlen des ausgewählten Tages">
            <div><strong>{selectedAppointments.length}</strong><span>Termine</span></div><div><strong>{free}</strong><span>Noch frei</span></div><div><strong>{mine}</strong><span>Meine</span></div>
          </div>
          <div className={data.employeeOfMonth.leaders.length ? "employee-month" : "employee-month employee-month--empty"} aria-label={`Mitarbeiter des Monats ${formatMonth(data.employeeOfMonth.month)}`}>
            <span className="employee-month__label">Mitarbeiter des Monats · {formatMonth(data.employeeOfMonth.month)}</span>
            {data.employeeOfMonth.leaders.length ? (
              <div className="employee-month__content">
                <span className="employee-month__portraits">
                  {data.employeeOfMonth.leaders.map((user) => (
                    <span className="employee-month__portrait" key={user.id}>
                      <Crown className="employee-month__crown" size={14} />
                      <UserAvatar user={user} className="avatar avatar--month" />
                    </span>
                  ))}
                </span>
                <span className="employee-month__copy">
                  <strong>{data.employeeOfMonth.leaders.length === 1 ? data.employeeOfMonth.leaders[0]!.displayName : "Gleichstand"}</strong>
                  <small>{data.employeeOfMonth.leaders.length === 1
                    ? `${data.employeeOfMonth.completedCount} ${data.employeeOfMonth.completedCount === 1 ? "Termin erledigt" : "Termine erledigt"}`
                    : `${data.employeeOfMonth.leaders.map((user) => user.displayName).join(" · ")} · je ${data.employeeOfMonth.completedCount}`}</small>
                </span>
              </div>
            ) : <small className="employee-month__empty">Noch keine abgeschlossenen Termine</small>}
          </div>
        </section>
        {profileOpen && (
          <div className="profile-menu" ref={profileMenuRef}>
            <div className="profile-menu__identity">
              <UserAvatar user={data.currentUser} className="avatar avatar--profile" />
              <div><strong>{data.currentUser.displayName}</strong><span>Dein Profilbild</span></div>
            </div>
            <button className="profile-menu__action" type="button" disabled={profileBusy} onClick={() => profileInputRef.current?.click()}>
              {profileBusy ? <LoaderCircle className="spin" size={16} /> : <ImagePlus size={16} />}
              {data.currentUser.avatar ? "Bild ersetzen" : "Bild hochladen"}
            </button>
            {data.currentUser.avatar && (
              <button className="profile-menu__action profile-menu__action--danger" type="button" disabled={profileBusy} onClick={askRemoveAvatar}>
                <UserRoundX size={16} />Bild entfernen
              </button>
            )}
            <small className="profile-menu__hint">JPEG, PNG oder WebP · maximal 20 MB</small>
            <input ref={profileInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadAvatar(event)} />
          </div>
        )}
        <div className="sidebar-user">
          <button ref={profileButtonRef} className="profile-trigger" type="button" onClick={() => setProfileOpen((current) => !current)} aria-expanded={profileOpen} aria-label="Profilbild verwalten" title="Profilbild verwalten">
            <UserAvatar user={data.currentUser} className="avatar" />
            <span className="profile-trigger__badge"><Camera size={10} /></span>
          </button>
          <div><strong>{data.currentUser.displayName}</strong><span>{data.currentUser.source === "dev" ? "Entwicklungszugang" : data.currentUser.username}</span></div>
          <button className="icon-button icon-button--on-dark" type="button" onClick={logout} aria-label="Abmelden" title="Abmelden"><LogOut size={17} /></button>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div><p className="eyebrow">Windows 11 Rollout</p><h1>Terminübersicht</h1></div>
          <div className="workspace-header__actions">
            <button className="icon-button refresh-button" type="button" onClick={() => void load(true)} disabled={refreshing} aria-label="Ansicht aktualisieren" title="Aktualisieren"><RefreshCw className={refreshing ? "spin" : ""} size={17} /></button>
            <button className="button button--primary button--create" type="button" onClick={() => openCreateDialog()}><Plus size={18} />Termine erstellen</button>
          </div>
        </header>

        <section
          className={
            rows.length > 6
              ? "schedule schedule--dense"
              : rows.length === 6
                ? "schedule schedule--six"
                : rows.length === 5
                  ? "schedule schedule--five"
                  : rows.length === 4
                    ? "schedule schedule--four"
                    : "schedule"
          }
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
                    )) : <button className="empty-slot" type="button" aria-label={`Termin für ${formatTime(row.startTime, row.endTime)} hinzufügen`} onClick={() => openCreateDialog(slotKey(row))}><Plus size={17} /><span><strong>Noch keine Termine</strong><small>Jetzt hinzufügen</small></span></button>}
                  </div>
                </section>
              );
            })}
          </div>
        </section>
      </main>

      {createOpen && <CreateDialog initialDate={selectedDate} initialSlotKey={createInitialSlotKey} dates={data.dates} fixedSlots={data.fixedSlots} maximum={data.limits.maxAppointmentsPerSlot} onClose={() => setCreateOpen(false)} onCreate={async (payload) => { await api.createAppointments(payload); await load(true); setCreateOpen(false); showToast("Termine wurden erstellt."); }} />}
      {editing && <EditDialog appointment={editing} users={data.users} onClose={() => setEditing(null)} onSave={async (payload) => { await mutate(editing, () => api.updateAppointment(editing.id, payload), "Termin gespeichert."); setEditing(null); }} />}
      {confirm && <ConfirmDialog title={confirm.title} message={confirm.message} destructive={confirm.destructive} busy={confirmBusy} onCancel={() => setConfirm(null)} onConfirm={() => void runConfirmed()} />}
      {toast && <div className={`toast toast--${toast.tone}`} role="status">{toast.tone === "success" ? <Check size={17} /> : <X size={17} />}{toast.message}</div>}
    </div>
  );
}
