import { Check, ClipboardCheck, LoaderCircle, Plus, Send, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { OldDeviceHostname } from "../shared/contracts";
import { api } from "./api";

function formatSubmittedAt(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

export function HostnamesDialog({
  isPreparer,
  onClose,
}: {
  isPreparer: boolean;
  onClose: () => void;
}) {
  const [hostname, setHostname] = useState("");
  const [name, setName] = useState("");
  const [entries, setEntries] = useState<OldDeviceHostname[] | null>(isPreparer ? null : []);
  const [loading, setLoading] = useState(isPreparer);
  const [busy, setBusy] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [preparerFormOpen, setPreparerFormOpen] = useState(false);
  const preparerFormRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!isPreparer) return;
    let active = true;
    setLoading(true);
    setError("");
    void api.listHostnames()
      .then((result) => {
        if (active) setEntries(result.hostnames);
      })
      .catch((caught) => {
        if (active) {
          setEntries(null);
          setError(caught instanceof Error ? caught.message : "Hostnames konnten nicht geladen werden.");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isPreparer]);

  useEffect(() => {
    if (preparerFormOpen) preparerFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [preparerFormOpen]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!hostname.trim()) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api.createHostname(hostname, name);
      if (isPreparer) {
        setEntries((current) => [result.hostname, ...(current ?? []).filter((entry) => entry.id !== result.hostname.id)]);
      }
      setHostname("");
      setName("");
      setMessage("Der Hostname wurde gespeichert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Der Hostname konnte nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  };

  const setProcessed = async (entry: OldDeviceHostname, isProcessed: boolean) => {
    setBusyIds((current) => new Set(current).add(entry.id));
    setError("");
    try {
      const result = await api.setHostnameProcessed(entry.id, isProcessed);
      setEntries((current) =>
        current?.map((item) => item.id === entry.id ? result.hostname : item) ?? current,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Der Status konnte nicht gespeichert werden.");
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(entry.id);
        return next;
      });
    }
  };

  const processedCount = entries?.filter((entry) => entry.isProcessed).length ?? 0;
  const orderedEntries = entries ? [...entries].sort((left, right) => Number(left.isProcessed) - Number(right.isProcessed)) : null;

  const hostnameForm = (
    <form ref={isPreparer ? preparerFormRef : undefined} className="hostnames__form" onSubmit={(event) => void submit(event)}>
      <label className="field">
        <span>Hostname</span>
        <input
          type="text"
          value={hostname}
          maxLength={253}
          placeholder="DIRXXXXX"
          autoComplete="off"
          required
          onChange={(event) => setHostname(event.target.value)}
        />
      </label>
      <label className="field">
        <span>Name <small>(optional)</small></span>
        <input
          type="text"
          value={name}
          maxLength={120}
          placeholder="Zum Beispiel: Max Mustermann"
          autoComplete="name"
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error && !isPreparer && <div className="alert alert--error" role="alert">{error}</div>}
      {message && <div className="alert alert--success" role="status"><Check size={15} />{message}</div>}
      <button className="button button--primary" type="submit" disabled={busy || !hostname.trim()}>
        {busy ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}
        Absenden
      </button>
    </form>
  );

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal modal--hostnames" role="dialog" aria-modal="true" aria-labelledby="hostnames-title">
        <header className="modal__header">
          <div><p className="eyebrow">Altgeräte</p><h2 id="hostnames-title">Hostnames</h2></div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Dialog schließen"><X size={20} /></button>
        </header>

        {isPreparer ? (
          <div className="modal__body hostnames__body">
            <div className="hostnames__intro">
              <div><strong>Auszutragende Altgeräte</strong><small>{entries ? `${processedCount} von ${entries.length} ausgetragen` : "Liste wird geladen"}</small></div>
              <p>Setze den Haken, sobald der Hostname am Altgerät ausgetragen wurde.</p>
            </div>
            {error && <div className="alert alert--error hostnames__error" role="alert">{error}</div>}
            {loading ? (
              <div className="hostnames__empty"><LoaderCircle className="spin" size={18} />Hostnames werden geladen …</div>
            ) : !orderedEntries || orderedEntries.length === 0 ? (
              <div className="hostnames__empty"><ClipboardCheck size={18} />Es wurden noch keine Hostnames eingetragen.</div>
            ) : (
              <div className="hostnames__list">
                {orderedEntries.map((entry) => {
                  const rowBusy = busyIds.has(entry.id);
                  return (
                    <label className={entry.isProcessed ? "hostnames__item is-processed" : "hostnames__item"} key={entry.id}>
                      <input
                        type="checkbox"
                        checked={entry.isProcessed}
                        disabled={rowBusy}
                        onChange={(event) => void setProcessed(entry, event.target.checked)}
                        aria-label={`${entry.hostname} als ausgetragen markieren`}
                      />
                      <span className="hostnames__item-check" aria-hidden="true">{rowBusy ? <LoaderCircle className="spin" size={15} /> : entry.isProcessed && <Check size={15} />}</span>
                      <span className="hostnames__item-copy">
                        <strong>{entry.hostname}</strong>
                        <span>{entry.name || "Kein Name hinterlegt"}</span>
                        <small>Eingetragen am {formatSubmittedAt(entry.submittedAt)} von {entry.submittedByName}</small>
                      </span>
                      <span className="hostnames__item-status">{entry.isProcessed ? "Ausgetragen" : "Offen"}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {preparerFormOpen && hostnameForm}
          </div>
        ) : (
          <div className="modal__body hostnames__body">
            <div className="hostnames__intro">
              <div><strong>Altgerät melden</strong><small>Hostname für die spätere Austragung eintragen.</small></div>
              <p>Trage den Hostname des Altgeräts ein. Der Name ist optional.</p>
            </div>
            {hostnameForm}
          </div>
        )}

        <footer className="modal__footer">
          <span className="modal__summary">{isPreparer ? "Offene Hostnames stehen oben in der Liste." : "Vorbereiter sehen den Eintrag anschließend in ihrer Liste."}</span>
          <div className="hostnames__footer-actions">
            {isPreparer && (
              <button
                className="button button--ghost"
                type="button"
                aria-expanded={preparerFormOpen}
                onClick={() => {
                  setPreparerFormOpen((open) => !open);
                  setError("");
                  setMessage("");
                }}
              >
                {preparerFormOpen ? <X size={16} /> : <Plus size={16} />}
                {preparerFormOpen ? "Eingabe schließen" : "Hostname eintragen"}
              </button>
            )}
            <button className="button button--ghost" type="button" onClick={onClose}>Schließen</button>
          </div>
        </footer>
      </section>
    </div>
  );
}
