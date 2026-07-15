# Rollout Planer

Schlanke interne Desktop-Webanwendung für Windows-11-Rollout-Termine. Das Team plant Termine für fünf aufeinanderfolgende Planungstage, weist sie bekannten Teammitgliedern zu und kann feste sowie eigene Uhrzeiten verwenden.

## Eigenschaften

- Authentik-Anmeldung über OAuth2/OpenID Connect mit Authorization Code, PKCE, `state` und `nonce`
- optionaler, ausschließlich per Entwicklungsmodus freischaltbarer Dev-Login
- keine Rollen: Jeder angemeldete Benutzer besitzt dieselben Rechte
- eigenes Profilbild per Upload (JPEG, PNG oder WebP bis 20 MB) mit Initialen als Fallback
- fünf Planungstage ab heute; Wochenenden und Feiertage werden bei den Folgetagen übersprungen
- Mitarbeiter des Monats anhand vergangener, zugewiesener Termine des zuletzt vollständig abgeschlossenen Kalendermonats, dauerhaft in der JSON-Datei gezählt
- feste Uhrzeiten 08–09, 09–10, 10–11, 11–12, 12–13 und 13–14 Uhr
- zusätzliche eigene Uhrzeit über „Von“ und „Bis“
- Schieberegler für 1–4 Termine sowie manuelle Sonderanzahl bis 50
- Offline-Berechnung der gesetzlichen Feiertage in Baden-Württemberg
- keine Datenbank: atomar geschriebene JSON-Datei im Docker-Volume
- kein Archiv: Abgelaufene Termine werden automatisch entfernt
- Schutz vor verlorenen gleichzeitigen Änderungen durch Versionsprüfung

## Schnellstart im Entwicklungsmodus

Die mitgelieferte lokale `.env` aktiviert den Entwicklungszugang. Sie wird durch `.gitignore` nicht versioniert.

```powershell
docker compose pull
docker compose up -d
```

Danach ist die Anwendung unter `http://localhost:8080` erreichbar. Auf der Anmeldeseite erscheint „Entwicklungszugang“.

Der Dev-Login wird nur aktiviert, wenn **beide** Werte gesetzt sind:

```dotenv
APP_MODE=development
DEV_LOGIN_ENABLED=true
```

Im Produktionsmodus bleibt der Dev-Endpunkt gesperrt, selbst wenn versehentlich nur `DEV_LOGIN_ENABLED=true` gesetzt wurde.

## Authentik für den Produktivbetrieb

1. In Authentik eine Anwendung mit einem OAuth2/OIDC-Provider erstellen.
2. Als Redirect-URI exakt `https://<interne-app-adresse>/auth/callback` hinterlegen.
3. Die Scopes `openid`, `profile` und `email` freigeben.
4. `.env.example` nach `.env` kopieren und mindestens diese Werte setzen:

```dotenv
APP_MODE=production
APP_BASE_URL=https://rollout.intern.example
SESSION_SECRET=<mindestens-32-zufällige-zeichen>
SESSION_COOKIE_SECURE=true
OIDC_ISSUER=https://authentik.intern.example/application/o/rollout-planer/
OIDC_CLIENT_ID=<client-id>
OIDC_CLIENT_SECRET=<client-secret>
DEV_LOGIN_ENABLED=false
```

5. Die Callback-Adresse in Authentik und `APP_BASE_URL` müssen einschließlich Schema und Host zusammenpassen.
6. Image laden und Container starten: `docker compose pull` und danach `docker compose up -d`.

Authentik selbst ist nicht Bestandteil dieser Compose-Datei; die Anwendung verbindet sich mit der bereits vorhandenen internen Instanz.

## Datenspeicherung

Die Datei `/app/data/rollout-state.json` liegt im benannten Volume `rollout-planer-data`. Gespeichert werden:

- Termine für die fünf angezeigten Planungstage
- monatliche Abschlussstatistik nach vollständigen Kalendermonaten statt rollierenden 30 Tagen
- Benutzer, die sich mindestens einmal erfolgreich angemeldet haben
- Profilbilder im Unterordner `avatars` desselben Docker-Volumes

Vergangene Termine werden beim nächsten Zugriff oder Neustart entfernt. Die Anwendung ist für genau eine Container-Instanz ausgelegt; mehrere parallele App-Replikate dürfen nicht dieselbe JSON-Datei verwenden.

Für eine Sicherung den Container kurz stoppen und das Docker-Volume `rollout-planer-data` mit der vorhandenen Server-Sicherungsstrategie sichern.

## Befehle

```powershell
pnpm typecheck
pnpm test
pnpm build
docker compose logs -f rollout-planer
docker compose down
```

`docker compose down` entfernt das Daten-Volume nicht. Ein Volume wird nur mit einer ausdrücklich zusätzlich angegebenen Volume-Option gelöscht.
