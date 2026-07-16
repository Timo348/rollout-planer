# Rollout Planer

Schlanke interne Desktop-Webanwendung für Windows-11-Rollout-Termine. Das Team plant Termine für fünf aufeinanderfolgende Planungstage, weist sie bekannten Teammitgliedern zu und kann feste sowie eigene Uhrzeiten verwenden.

## Eigenschaften

- Authentik-Anmeldung über OAuth2/OpenID Connect mit Authorization Code, PKCE, `state` und `nonce`
- optionaler, ausschließlich per Entwicklungsmodus freischaltbarer Dev-Login
- alle angemeldeten Benutzer dürfen Termine planen und verwalten
- lokale Benutzerverwaltung für Mitglieder der Authentik-Gruppe `rollout-planner-admin`
- eigenes Profilbild per Upload (JPEG, PNG oder WebP bis 20 MB) mit Initialen als Fallback
- fünf Planungstage ab heute; Wochenenden und Feiertage werden bei den Folgetagen übersprungen
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
3. Die Scopes `openid`, `profile` und `email` freigeben. Das `profile`-Mapping muss den Claim `groups` als Liste im ID-Token ausgeben.
4. In Authentik die Gruppe `rollout-planner-admin` anlegen und alle Personen hinzufügen, die Benutzer aus dem Rollout Planer entfernen dürfen.
5. `.env.example` nach `.env` kopieren und mindestens diese Werte setzen:

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

6. Die Callback-Adresse in Authentik und `APP_BASE_URL` müssen einschließlich Schema und Host zusammenpassen.
7. Image laden und Container starten: `docker compose pull` und danach `docker compose up -d`.

Authentik selbst ist nicht Bestandteil dieser Compose-Datei; die Anwendung verbindet sich mit der bereits vorhandenen internen Instanz.

## Benutzerverwaltung

Mitglieder der Authentik-Gruppe `rollout-planner-admin` sehen neben „Termine erstellen“ die Benutzerverwaltung. Die Berechtigung wird aus dem verifizierten Gruppen-Claim abgeleitet, in der signierten App-Sitzung gespeichert und zusätzlich bei jeder Löschanfrage serverseitig geprüft. Nach dem Update oder einer Gruppenänderung müssen sich betroffene Administratoren einmal ab- und wieder anmelden.

„Benutzer löschen“ entfernt ausschließlich das lokale Profil aus dem Rollout Planer. Dabei wird das Profilbild der Person entfernt; ihre noch zugewiesenen Termine bleiben bestehen und werden wieder frei. Das Authentik-Konto selbst wird nicht verändert. Solange das Konto in Authentik weiterhin Zugriff besitzt, kann sich die Person erneut anmelden und wird dann lokal wieder angelegt. Das eigene aktuell angemeldete Profil kann nicht gelöscht werden.

Der optionale Dev-Login erhält die Verwaltungsberechtigung nur im ausdrücklich aktivierten Entwicklungsmodus, damit der Ablauf lokal getestet werden kann. Im Produktionsmodus bleibt dieser Zugang vollständig deaktiviert.

## Datenspeicherung

Die Datei `/app/data/rollout-state.json` liegt im benannten Volume `rollout-planer-data`. Gespeichert werden:

- Termine für die fünf angezeigten Planungstage
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
