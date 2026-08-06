import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  LoaderCircle,
  Moon,
  RefreshCw,
  Sun,
  UserRoundCheck,
  UserRoundX,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { PublicDashboardResponse } from "../shared/contracts";
import { api, ApiError } from "./api";
import { useTheme } from "./theme";

function formatDate(date: string, long = false): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: long ? "long" : "short",
    day: "2-digit",
    month: long ? "long" : "2-digit",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatGeneratedAt(value: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "short",
    timeStyle: "medium",
    timeZone: "Europe/Berlin",
  }).format(new Date(value));
}

function Brand() {
  return (
    <div className="public-brand">
      <div className="brand-mark" aria-hidden="true"><span /><span /><span /><span /></div>
      <strong>Rollout Planer</strong>
    </div>
  );
}

export function PublicDashboardPage({ slug }: { slug?: string }) {
  const [data, setData] = useState<PublicDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [theme, toggleTheme] = useTheme();

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    try {
      const next = await api.publicDashboard(slug);
      setData(next);
      setError("");
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.status === 404
          ? "Dieses öffentliche Dashboard ist nicht verfügbar."
          : caught instanceof Error
            ? caught.message
            : "Das Dashboard konnte nicht geladen werden.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!data?.dashboard.refreshSeconds) return;
    const timer = window.setInterval(
      () => void load(true),
      data.dashboard.refreshSeconds * 1000,
    );
    return () => window.clearInterval(timer);
  }, [data?.dashboard.refreshSeconds, load]);

  useEffect(() => {
    if (data?.dashboard.title) document.title = `${data.dashboard.title} · Rollout Planer`;
    return () => { document.title = "Rollout Planer"; };
  }, [data?.dashboard.title]);

  const appointmentsByDate = useMemo(() => {
    if (!data) return new Map<string, PublicDashboardResponse["appointments"]>();
    const result = new Map<string, PublicDashboardResponse["appointments"]>();
    for (const date of data.visibleDates) result.set(date, []);
    for (const appointment of data.appointments) {
      result.get(appointment.date)?.push(appointment);
    }
    return result;
  }, [data]);

  if (loading) {
    return <main className="public-state"><LoaderCircle className="spin" size={25} /><span>Dashboard wird geladen …</span></main>;
  }

  if (error || !data) {
    return (
      <main className="public-state public-state--error">
        <Brand />
        <CalendarDays size={34} />
        <h1>Dashboard nicht verfügbar</h1>
        <p>{error}</p>
        <button className="button button--ghost" type="button" onClick={() => void load()}>
          <RefreshCw size={16} />Erneut versuchen
        </button>
      </main>
    );
  }

  const maximumTrend = Math.max(1, ...data.trend.map((point) => point.completed));
  const quick = data.quickOverview;

  return (
    <div className="public-dashboard">
      <header className="public-header">
        <Brand />
        <div className="public-header__actions">
          <span>Stand: {formatGeneratedAt(data.generatedAt)}</span>
          <button className="icon-button" type="button" disabled={refreshing} onClick={() => void load(true)} aria-label="Aktualisieren" title="Aktualisieren">
            <RefreshCw className={refreshing ? "spin" : ""} size={17} />
          </button>
          <button className="icon-button" type="button" onClick={toggleTheme} aria-label="Farbschema wechseln" title="Farbschema wechseln">
            {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <main className="public-content">
        <section className="public-hero">
          <p className="eyebrow">Öffentliche Übersicht</p>
          <h1>{data.dashboard.title}</h1>
          {data.dashboard.subtitle && <p>{data.dashboard.subtitle}</p>}
        </section>

        {quick && (
          <section className="public-quick" aria-label="Schnellübersicht">
            <article><CalendarDays size={19} /><span>Heute geplant</span><strong>{quick.todayPlanned}</strong></article>
            <article><UserRoundCheck size={19} /><span>Zugewiesen</span><strong>{quick.todayAssigned}</strong></article>
            <article><UserRoundX size={19} /><span>Unbesetzt</span><strong>{quick.todayUnassigned}</strong></article>
            {data.dashboard.showPreparationStatus && <article><CheckCircle2 size={19} /><span>Vorbereitet</span><strong>{quick.todayPrepared}</strong></article>}
            <article><CheckCircle2 size={19} /><span>Erledigt ({data.dashboard.trendDays} Tage)</span><strong>{quick.completedInTrend}</strong></article>
            {quick.tomorrowPlanned !== undefined && <article><CalendarDays size={19} /><span>Morgen geplant</span><strong>{quick.tomorrowPlanned}</strong></article>}
          </section>
        )}

        <div className="public-grid">
          <section className="public-panel public-schedule" aria-labelledby="public-schedule-title">
            <div className="public-panel__heading">
              <div><p className="eyebrow">Planung</p><h2 id="public-schedule-title">Terminübersicht</h2></div>
              <span>{data.appointments.length} {data.appointments.length === 1 ? "Termin" : "Termine"}</span>
            </div>
            <div className="public-days">
              {[...appointmentsByDate].map(([date, appointments]) => (
                <article className="public-day" key={date}>
                  <header><strong>{date === data.dates.today ? "Heute" : formatDate(date, true)}</strong><span>{formatDate(date)}</span></header>
                  {appointments.length === 0 ? (
                    <p className="public-day__empty">Keine Termine geplant</p>
                  ) : (
                    <div className="public-appointments">
                      {appointments.map((appointment) => (
                        <div className="public-appointment" key={appointment.id}>
                          <span className="public-appointment__time"><Clock3 size={14} />{appointment.startTime}–{appointment.endTime}</span>
                          <div>
                            <strong>{appointment.name ?? "Termin"}</strong>
                            <small>{appointment.assigneeName ?? (appointment.isAssigned ? "Zugewiesen" : "Noch nicht zugewiesen")}</small>
                          </div>
                          {appointment.isPrepared !== undefined && (
                            <span className={appointment.isPrepared ? "public-status is-ready" : "public-status"}>
                              {appointment.isPrepared ? "Vorbereitet" : "Offen"}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </section>

          <section className="public-panel public-trend" aria-labelledby="public-trend-title">
            <div className="public-panel__heading">
              <div><p className="eyebrow">Letzte {data.dashboard.trendDays} Tage</p><h2 id="public-trend-title">Tagestrend</h2></div>
              <span>Erledigte Termine</span>
            </div>
            <div className="trend-chart" role="img" aria-label={`Erledigte Termine der letzten ${data.dashboard.trendDays} Tage`}>
              {data.trend.map((point) => (
                <div className="trend-bar" key={point.date} title={`${formatDate(point.date)}: ${point.completed}`}>
                  <span>{point.completed}</span>
                  <i style={{ "--trend-height": `${Math.max(point.completed ? 8 : 2, (point.completed / maximumTrend) * 100)}%` } as CSSProperties} />
                  <small>{data.dashboard.trendDays === 7 || point.date.endsWith("-01") ? formatDate(point.date) : point.date.slice(-2)}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
