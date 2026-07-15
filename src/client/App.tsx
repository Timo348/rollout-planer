import { useEffect, useState } from "react";
import { ArrowRight, CalendarDays, LoaderCircle, ShieldCheck } from "lucide-react";
import type { SessionResponse } from "../shared/contracts";
import { api, ApiError } from "./api";
import { Dashboard } from "./Dashboard";

function LoadingScreen() {
  return (
    <main className="loading-screen" aria-live="polite">
      <div className="brand-mark brand-mark--large" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      <LoaderCircle className="spin" size={22} />
      <span>Rollout Planer wird geladen …</span>
    </main>
  );
}

function LoginScreen({
  session,
  initialError,
  onDevLogin,
}: {
  session: SessionResponse;
  initialError: string;
  onDevLogin: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);

  const devLogin = async () => {
    setBusy(true);
    setError("");
    try {
      await onDevLogin();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Entwicklungslogin fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-page">
      <section className="login-visual" aria-label="Windows 11 Rollout Planung">
        <div className="login-visual__glow login-visual__glow--one" />
        <div className="login-visual__glow login-visual__glow--two" />
        <div className="login-visual__content">
          <div className="brand-lockup brand-lockup--light">
            <div className="brand-mark" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
            <span>Rollout Planer</span>
          </div>
          <div>
            <p className="eyebrow eyebrow--light">Windows 11 Rollout</p>
            <h1>Termine verteilen.<br />Ohne Abstimmungschaos.</h1>
            <p className="login-visual__text">
              Alle Kundentermine und Zuständigkeiten auf einen Blick – schnell geplant, klar verteilt.
            </p>
          </div>
          <div className="login-preview" aria-hidden="true">
            <div className="login-preview__time">10:00</div>
            <div className="login-preview__card">
              <span className="login-preview__dot" />
              <div><strong>Beispieltermin</strong><small>Bereit zur Zuweisung</small></div>
            </div>
          </div>
        </div>
      </section>

      <section className="login-panel">
        <div className="login-panel__inner">
          <div className="login-icon"><CalendarDays size={28} /></div>
          <p className="eyebrow">Interne Terminplanung</p>
          <h2>Willkommen zurück</h2>
          <p className="login-panel__copy">
            Melde dich mit deinem Firmenkonto an, um Rollout-Termine zu planen und zu übernehmen.
          </p>

          {error && <div className="alert alert--error" role="alert">{error}</div>}

          {session.oidcEnabled && (
            <a className="button button--primary button--large" href="/auth/login">
              Mit Authentik anmelden <ArrowRight size={18} />
            </a>
          )}

          {session.devLoginEnabled && (
            <button
              className="button button--dev button--large"
              type="button"
              disabled={busy}
              onClick={devLogin}
            >
              {busy ? <LoaderCircle className="spin" size={18} /> : <ShieldCheck size={18} />}
              Entwicklungszugang
            </button>
          )}

          <div className="login-security">
            <ShieldCheck size={16} />
            <span>Zugriff ausschließlich im internen Firmennetz</span>
          </div>
        </div>
      </section>
    </main>
  );
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [error, setError] = useState("");

  const loadSession = async () => {
    try {
      setSession(await api.session());
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "Die Anwendung ist nicht erreichbar.");
      setSession({ authenticated: false, user: null, devLoginEnabled: false, oidcEnabled: false });
    }
  };

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const authError = query.get("authError") ?? "";
    if (authError) {
      setError(authError);
      window.history.replaceState({}, "", window.location.pathname);
    }
    void loadSession();
  }, []);

  if (!session) return <LoadingScreen />;
  if (!session.authenticated || !session.user) {
    return (
      <LoginScreen
        session={session}
        initialError={error}
        onDevLogin={async () => {
          await api.devLogin();
          await loadSession();
        }}
      />
    );
  }

  return (
    <Dashboard
      sessionUser={session.user}
      onLoggedOut={() =>
        setSession((current) =>
          current ? { ...current, authenticated: false, user: null } : current,
        )
      }
    />
  );
}
