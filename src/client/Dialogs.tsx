import {
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  LoaderCircle,
  Plus,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { AppUser, Appointment, FixedSlot, ScheduleDates } from "../shared/contracts";

interface SlotDraft extends FixedSlot {
  count: number;
  names: string[];
}

function formatDate(date: string): string {
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

function createDraft(slot: FixedSlot): SlotDraft {
  return { ...slot, count: 1, names: [""] };
}

function slotKey(slot: FixedSlot): string {
  return `${slot.startTime}-${slot.endTime}`;
}

function CountControl({
  value,
  maximum,
  onChange,
}: {
  value: number;
  maximum: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="count-control">
      <div className="count-control__topline">
        <span>Anzahl Termine</span>
        {value > 4 && <span className="badge badge--special">Sonderanzahl</span>}
      </div>
      <div className="count-control__inputs">
        <input
          aria-label="Anzahl über Schieberegler"
          type="range"
          min="1"
          max="4"
          value={Math.min(value, 4)}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <label className="number-input">
          <input
            aria-label="Anzahl manuell eingeben"
            type="number"
            min="1"
            max={maximum}
            value={value}
            onChange={(event) =>
              onChange(Math.max(1, Math.min(maximum, Number(event.target.value) || 1)))
            }
          />
          <span>Termine</span>
        </label>
      </div>
      <div className="range-labels" aria-hidden="true"><span>1</span><span>2</span><span>3</span><span>4</span></div>
    </div>
  );
}

function NameInputs({
  draft,
  onChange,
  onEnter,
}: {
  draft: SlotDraft;
  onChange: (index: number, value: string) => void;
  onEnter: (event: KeyboardEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="name-inputs">
      {draft.names.map((name, index) => (
        <label className="field" key={index}>
          <span>Terminname {index + 1}</span>
          <input
            data-appointment-name
            value={name}
            maxLength={120}
            placeholder="z. B. Muster GmbH"
            onChange={(event) => onChange(index, event.target.value)}
            onKeyDown={onEnter}
          />
        </label>
      ))}
    </div>
  );
}

export function CreateDialog({
  initialDate,
  dates,
  fixedSlots,
  maximum,
  onClose,
  onCreate,
}: {
  initialDate: string;
  dates: ScheduleDates;
  fixedSlots: FixedSlot[];
  maximum: number;
  onClose: () => void;
  onCreate: (payload: {
    date: string;
    slots: Array<{ startTime: string; endTime: string; names: string[] }>;
  }) => Promise<void>;
}) {
  const [date, setDate] = useState(initialDate);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, SlotDraft>>(() =>
    Object.fromEntries(fixedSlots.map((slot) => [slotKey(slot), createDraft(slot)])),
  );
  const [customEnabled, setCustomEnabled] = useState(false);
  const [customDraft, setCustomDraft] = useState<SlotDraft>({
    startTime: "",
    endTime: "",
    count: 1,
    names: [""],
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const total = useMemo(
    () =>
      [...selected].reduce((sum, key) => sum + drafts[key]!.count, 0) +
      (customEnabled ? customDraft.count : 0),
    [customDraft.count, customEnabled, drafts, selected],
  );

  const setCount = (key: string, count: number) => {
    setDrafts((current) => {
      const draft = current[key]!;
      return {
        ...current,
        [key]: {
          ...draft,
          count,
          names: Array.from({ length: count }, (_, index) => draft.names[index] ?? ""),
        },
      };
    });
  };

  const setCustomCount = (count: number) =>
    setCustomDraft((current) => ({
      ...current,
      count,
      names: Array.from({ length: count }, (_, index) => current.names[index] ?? ""),
    }));

  const toggleSlot = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const moveToNextName = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const fields = Array.from(
      formRef.current?.querySelectorAll<HTMLInputElement>("input[data-appointment-name]") ?? [],
    );
    const index = fields.indexOf(event.currentTarget);
    fields[index + 1]?.focus();
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const slots = [...selected].map((key) => drafts[key]!);
    if (customEnabled) {
      if (!customDraft.startTime || !customDraft.endTime) {
        setError("Bitte Start- und Endzeit der eigenen Uhrzeit angeben.");
        return;
      }
      if (customDraft.endTime <= customDraft.startTime) {
        setError("Die Endzeit muss nach der Startzeit liegen.");
        return;
      }
      slots.push(customDraft);
    }
    if (slots.length === 0) {
      setError("Bitte mindestens eine Uhrzeit auswählen.");
      return;
    }
    if (slots.some((slot) => slot.names.some((name) => !name.trim()))) {
      setError("Bitte für jeden Termin einen Terminnamen eintragen.");
      return;
    }

    setSaving(true);
    try {
      await onCreate({
        date,
        slots: slots.map((slot) => ({
          startTime: slot.startTime,
          endTime: slot.endTime,
          names: slot.names.map((name) => name.trim()),
        })),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Termine konnten nicht erstellt werden.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal modal--wide" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <header className="modal__header">
          <div>
            <p className="eyebrow">Schnellerfassung</p>
            <h2 id="create-title">Termine erstellen</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Dialog schließen"><X size={20} /></button>
        </header>

        <form ref={formRef} onSubmit={submit}>
          <div className="modal__body">
            <div className="form-section">
              <div className="form-section__heading"><span>1</span><div><strong>Tag auswählen</strong><small>Für wann planst du?</small></div></div>
              <div className="date-choice date-choice--compact">
                <button className={date === dates.today ? "date-choice__button is-active" : "date-choice__button"} type="button" onClick={() => setDate(dates.today)}>
                  <CalendarDays size={18} /><span><small>Heute</small><strong>{formatDate(dates.today)}</strong></span>{date === dates.today && <Check size={17} />}
                </button>
                <button className={date === dates.nextWorkday ? "date-choice__button is-active" : "date-choice__button"} type="button" onClick={() => setDate(dates.nextWorkday)}>
                  <CalendarDays size={18} /><span><small>Nächster Arbeitstag</small><strong>{formatDate(dates.nextWorkday)}</strong></span>{date === dates.nextWorkday && <Check size={17} />}
                </button>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section__heading"><span>2</span><div><strong>Uhrzeiten festlegen</strong><small>Mehrfachauswahl möglich</small></div></div>
              <div className="slot-picker">
                {fixedSlots.map((slot) => {
                  const key = slotKey(slot);
                  const active = selected.has(key);
                  return (
                    <button className={active ? "slot-picker__item is-active" : "slot-picker__item"} type="button" key={key} onClick={() => toggleSlot(key)}>
                      <span className="checkbox-visual">{active && <Check size={14} />}</span>
                      <Clock3 size={17} />
                      <strong>{formatTime(slot.startTime, slot.endTime)}</strong>
                    </button>
                  );
                })}
              </div>
              <label className={customEnabled ? "custom-time-toggle is-active" : "custom-time-toggle"}>
                <input type="checkbox" checked={customEnabled} onChange={(event) => setCustomEnabled(event.target.checked)} />
                <span className="checkbox-visual">{customEnabled && <Check size={14} />}</span>
                <Plus size={17} /><span><strong>Eigene Uhrzeit</strong><small>Individuellen Zeitraum hinzufügen</small></span>
              </label>
            </div>

            {(selected.size > 0 || customEnabled) && (
              <div className="form-section">
                <div className="form-section__heading"><span>3</span><div><strong>Termine benennen</strong><small>Anzahl einstellen und Kundennamen eintragen</small></div></div>
                <div className="draft-list">
                  {[...selected].map((key) => {
                    const draft = drafts[key]!;
                    return (
                      <section className="draft-card" key={key}>
                        <header><div className="draft-card__time"><Clock3 size={17} /><strong>{formatTime(draft.startTime, draft.endTime)}</strong></div><button type="button" className="text-button text-button--danger" onClick={() => toggleSlot(key)}>Entfernen</button></header>
                        <CountControl value={draft.count} maximum={maximum} onChange={(count) => setCount(key, count)} />
                        <NameInputs draft={draft} onEnter={moveToNextName} onChange={(index, value) => setDrafts((current) => ({ ...current, [key]: { ...current[key]!, names: current[key]!.names.map((name, nameIndex) => nameIndex === index ? value : name) } }))} />
                      </section>
                    );
                  })}

                  {customEnabled && (
                    <section className="draft-card draft-card--custom">
                      <header><div className="draft-card__time"><Clock3 size={17} /><strong>Eigene Uhrzeit</strong></div><span className="badge">Individuell</span></header>
                      <div className="time-fields">
                        <label className="field"><span>Von</span><input type="time" value={customDraft.startTime} onChange={(event) => setCustomDraft((current) => ({ ...current, startTime: event.target.value }))} /></label>
                        <ChevronRight size={18} />
                        <label className="field"><span>Bis</span><input type="time" value={customDraft.endTime} onChange={(event) => setCustomDraft((current) => ({ ...current, endTime: event.target.value }))} /></label>
                      </div>
                      <CountControl value={customDraft.count} maximum={maximum} onChange={setCustomCount} />
                      <NameInputs draft={customDraft} onEnter={moveToNextName} onChange={(index, value) => setCustomDraft((current) => ({ ...current, names: current.names.map((name, nameIndex) => nameIndex === index ? value : name) }))} />
                    </section>
                  )}
                </div>
              </div>
            )}

            {error && <div className="alert alert--error" role="alert">{error}</div>}
          </div>
          <footer className="modal__footer">
            <span className="modal__summary">{total > 0 ? (total === 1 ? "1 Termin wird erstellt" : `${total} Termine werden erstellt`) : "Noch keine Uhrzeit ausgewählt"}</span>
            <button className="button button--ghost" type="button" onClick={onClose}>Abbrechen</button>
            <button className="button button--primary" type="submit" disabled={saving || total === 0}>{saving ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}Termine erstellen</button>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function EditDialog({
  appointment,
  users,
  onClose,
  onSave,
}: {
  appointment: Appointment;
  users: AppUser[];
  onClose: () => void;
  onSave: (payload: { version: number; name: string; startTime: string; endTime: string; assigneeId: string | null }) => Promise<void>;
}) {
  const [name, setName] = useState(appointment.name);
  const [startTime, setStartTime] = useState(appointment.startTime);
  const [endTime, setEndTime] = useState(appointment.endTime);
  const [assigneeId, setAssigneeId] = useState(appointment.assigneeId ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return setError("Bitte einen Terminnamen eintragen.");
    if (!startTime || !endTime || endTime <= startTime) return setError("Die Endzeit muss nach der Startzeit liegen.");
    setSaving(true);
    setError("");
    try {
      await onSave({ version: appointment.version, name: name.trim(), startTime, endTime, assigneeId: assigneeId || null });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Termin konnte nicht gespeichert werden.");
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal modal--small" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <header className="modal__header"><div><p className="eyebrow">Termin bearbeiten</p><h2 id="edit-title">Details anpassen</h2></div><button className="icon-button" type="button" onClick={onClose} aria-label="Dialog schließen"><X size={20} /></button></header>
        <form onSubmit={submit}>
          <div className="modal__body modal__body--simple">
            <label className="field"><span>Terminname</span><input autoFocus value={name} maxLength={120} onChange={(event) => setName(event.target.value)} /></label>
            <div className="time-fields">
              <label className="field"><span>Von</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} /></label>
              <ChevronRight size={18} />
              <label className="field"><span>Bis</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} /></label>
            </div>
            <label className="field"><span>Zugewiesen an</span><div className="select-wrap"><UserRound size={16} /><select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value="">Nicht zugewiesen</option>{users.map((user) => <option value={user.id} key={user.id}>{user.displayName}</option>)}</select></div></label>
            {error && <div className="alert alert--error" role="alert">{error}</div>}
          </div>
          <footer className="modal__footer"><span /><button className="button button--ghost" type="button" onClick={onClose}>Abbrechen</button><button className="button button--primary" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />}Speichern</button></footer>
        </form>
      </section>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  destructive = false,
  busy = false,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  destructive?: boolean;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="modal-backdrop modal-backdrop--top" role="presentation">
      <section className="modal modal--confirm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
        <div className={destructive ? "confirm-icon confirm-icon--danger" : "confirm-icon"}>{destructive ? <Trash2 size={23} /> : <UserRound size={23} />}</div>
        <h2 id="confirm-title">{title}</h2><p>{message}</p>
        <div className="confirm-actions"><button className="button button--ghost" type="button" disabled={busy} onClick={onCancel}>Abbrechen</button><button className={destructive ? "button button--danger" : "button button--primary"} type="button" disabled={busy} onClick={onConfirm}>{busy && <LoaderCircle className="spin" size={17} />}Bestätigen</button></div>
      </section>
    </div>
  );
}
