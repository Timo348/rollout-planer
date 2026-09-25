# Rollout Planer

Schlanke interne Desktop-Webanwendung für Windows-11-Rollout-Termine. Das Team plant Termine für fünf aufeinanderfolgende Planungstage, weist sie bekannten Teammitgliedern zu und kann feste sowie eigene Uhrzeiten verwenden.

## Eigenschaften

- Authentik-Anmeldung über OAuth2/OpenID Connect mit Authorization Code, PKCE, `state` und `nonce`
- optionaler, ausschließlich per Entwicklungsmodus freischaltbarer Dev-Login
- lokales Administrationskonto mit Anmeldename und Passwort (Standard `admin`/`admin`, per Umgebungsvariable änderbar)
- alle angemeldeten Personen dürfen Termine planen und verwalten
- lokale Profilverwaltung für Mitglieder der Authentik-Gruppe `rollout-planner-admin`
- administrativ aktivierbare Vorbereitungsrolle mit eigener Terminprüfung
- offene Vorbereitungen erscheinen für die Vorbereitungsrolle rot und lassen sich per Haken als vorbereitet markieren
- eigenes Profilbild per Upload (JPEG, PNG oder WebP bis 20 MB) mit Initialen als Fallback
- fünf Planungstage ab heute; Wochenenden und Feiertage werden bei den Folgetagen übersprungen
- feste Uhrzeiten 08–09, 09–10, 10–11, 11–12, 12–13 und 13–14 Uhr
- zusätzliche eigene Uhrzeit über „Von“ und „Bis“
- Schieberegler für 1–4 Termine sowie manuelle Sonderanzahl bis 50
- Offline-Berechnung der gesetzlichen Feiertage in Baden-Württemberg
- PostgreSQL-Datenbank als eigener Compose-Dienst; bestehender JSON-Bestand wird beim ersten Start automatisch importiert
- Historie für die Administration: Entfernte oder vergangene Termine werden pro Tag in einer eigenen Datenbanktabelle (`history_JJJJ_MM_TT`) mit zugewiesener Person, Terminname und Uhrzeit archiviert
- tägliche Termin-E-Mail um 07:00 Uhr (Europe/Berlin) als Kalendereinladung pro Termin (iCal mit Annehmen/Ablehnen) an die in Authentik hinterlegte Mailadresse, sobald SMTP konfiguriert ist
- manueller Versand der Tagesagenda per Button „Terminmail heute senden“ neben der Profilverwaltung (nur mit Administrationsberechtigung über die Authentik-Gruppe `rollout-planner-admin`)
- Rückblick auf vergangene Tage über die Navigation: archivierte Termine inklusive Zuweisung pro Tag einsehen
- Statistik mit Administrationsberechtigung (Authentik-Gruppe `rollout-planner-admin`) im Arbeitsbereich: durchgeführte Termine pro Person für die letzten 14 Tage, den aktuellen Monat oder insgesamt, mit manueller Plus/Minus-Korrektur; die Zählung aktualisiert sich automatisch mit der täglichen Archivierung
- Änderungsmodul für alle Personen: Alle angemeldeten Personen veröffentlichen Meldungen mit bis zu 125 Wörtern; löschen darf sie nur die Administration. Nach 21 Tagen wechseln Meldungen automatisch von „Aktuelles“ nach „Allgemeines“, neue Meldungen werden pro Profil mit `!` markiert und bei konfiguriertem SMTP zusätzlich per E-Mail angekündigt
- Hostname-Modul für Altgeräte: Alle Personen melden einen Hostname mit optionalem Namen; Personen mit Vorbereitungsrolle sehen die Einträge und markieren per Haken, sobald ein Hostname ausgetragen wurde
- optionaler Punkt „Anleitung“ in der linken Navigation; das Ziel wird mit `GUIDE_URL` in `.env`/Compose konfiguriert und in einem neuen Tab geöffnet
- mehrere frei benennbare, öffentliche Termin-Dashboards unter `/public/<kurzlink>` mit eigener Datenschutz-, Zeitraum-, Trend-, Aktualisierungs-, Standardmodus-, Zoom- und 14-Tage-Podium-Konfiguration; das Podium zeigt ausschließlich die Profilbilder der Top 3, `/public` zeigt das festgelegte Standard-Dashboard und nutzt auf TV-Bildschirmen die volle Fläche ohne Seiten-Scrollbar
- responsive Bedienung für Desktop, iPad/Tablet und Smartphone einschließlich mobiler Navigation, scrollbarer Terminplanung und angepasster Dialoge
- tägliche Termin-E-Mail und E-Mail bei neuen Änderungen pro Person unabhängig voneinander abbestellbar (Umschalter im Profilmenü)
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
4. In Authentik die Gruppe `rollout-planner-admin` anlegen und alle Konten hinzufügen, die Profile aus dem Rollout Planer entfernen dürfen.
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
GUIDE_URL=https://wiki.intern.example/rollout-anleitung
```

6. Die Callback-Adresse in Authentik und `APP_BASE_URL` müssen einschließlich Schema und Host zusammenpassen.
7. Image laden und Container starten: `docker compose pull` und danach `docker compose up -d`.

`GUIDE_URL` ist optional. Bleibt der Wert leer, wird der Navigationspunkt „Anleitung“ nicht angezeigt. Erlaubt sind vollständige HTTP- und HTTPS-Adressen.

Authentik selbst ist nicht Bestandteil dieser Compose-Datei; die Anwendung verbindet sich mit der bereits vorhandenen internen Instanz.

## Lokales Administrationskonto

Zusätzlich zu Authentik gibt es ein lokales Administrationskonto mit Anmeldename und Passwort direkt auf der Anmeldeseite. Standard ist `admin`/`admin`; das Konto erhält die Berechtigung zur Profilverwaltung und erscheint als Profil `Administration`. Zum Ändern oder Abschalten:

```dotenv
ADMIN_LOGIN_ENABLED=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<eigenes-passwort>
```

Beim Deaktivieren (`ADMIN_LOGIN_ENABLED=false`) verlieren bestehende Sitzungen des Administrationskontos sofort ihre Gültigkeit. Der Zugang ist für das interne Netz gedacht — in Produktion gehört mindestens ein eigenes Passwort her.

## Profilverwaltung

Mitglieder der Authentik-Gruppe `rollout-planner-admin` sehen neben „Termine erstellen“ die Profilverwaltung. Die Berechtigung wird aus dem verifizierten Gruppen-Claim abgeleitet, in der signierten App-Sitzung gespeichert und zusätzlich bei jeder Löschanfrage serverseitig geprüft. Nach dem Update oder einer Gruppenänderung müssen sich betroffene Personen einmal ab- und wieder anmelden.

„Profil löschen“ entfernt ausschließlich das lokale Profil aus dem Rollout Planer. Dabei wird das Profilbild der Person entfernt; ihre noch zugewiesenen Termine bleiben bestehen und werden wieder frei. Das Authentik-Konto selbst wird nicht verändert. Solange das Konto in Authentik weiterhin Zugriff besitzt, kann sich die Person erneut anmelden und wird dann lokal wieder angelegt. Das eigene aktuell angemeldete Profil kann nicht gelöscht werden.

Der optionale Dev-Login erhält die Verwaltungsberechtigung nur im ausdrücklich aktivierten Entwicklungsmodus, damit der Ablauf lokal getestet werden kann. Im Produktionsmodus bleibt dieser Zugang vollständig deaktiviert.

## Tägliche Termin-E-Mail

Ist `SMTP_HOST` gesetzt, versendet die Anwendung jeden Morgen um 07:00 Uhr (Zeitzone Europe/Berlin) an jede Person mit zugewiesenen Terminen am selben Tag pro Termin eine eigene E-Mail. Zieladresse ist die Mailadresse aus dem Authentik-Profil (`email`-Claim). Jeder Termin steckt als eigene Kalendereinladung (`rollout-termin-<datum>-<uhrzeit>.ics`, iCal `METHOD:REQUEST`) im Anhang — bewusst eine Einladung pro Mail, weil Kalender-Clients bei `METHOD:REQUEST` nur einen Termin pro Nachricht zuverlässig übernehmen. Die Einladung kann im Kalender-Client direkt angenommen oder abgelehnt werden; die Antwort bleibt dabei lokal im Kalender (`RSVP=FALSE`), es geht keine Antwort-E-Mail an die absendende Stelle. Als Absenderadresse gilt `SMTP_FROM`. Profile ohne hinterlegte Mailadresse und Tage ohne zugewiesene Termine werden übersprungen; ohne `SMTP_HOST` bleibt der Versand vollständig deaktiviert. Jede angemeldete Person kann den Empfang im Profilmenü (Umschalter „Tägliche Termin-E-Mail“) deaktivieren und wieder aktivieren; die Einstellung bleibt über Anmeldungen hinweg erhalten. Personen mit Administrationsberechtigung (Authentik-Gruppe `rollout-planner-admin`) können denselben Versand jederzeit manuell über den Button „Terminmail heute senden“ neben der Profilverwaltung auslösen (`POST /api/agenda/send`); ohne SMTP-Konfiguration antwortet der Endpunkt mit einer Fehlermeldung.

```dotenv
SMTP_HOST=mail.intern.example
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=<smtp-anmeldename>
SMTP_PASS=<smtp-passwort>
SMTP_FROM=rollout-planer@intern.example
```

### E-Mail bei neuen Änderungen

Beim Veröffentlichen einer neuen Meldung versendet die Anwendung über dieselbe SMTP-Konfiguration eine Benachrichtigung an alle anderen Profile mit hinterlegter Authentik-Mailadresse. Diese Benachrichtigung ist standardmäßig aktiviert und kann im Profilmenü unabhängig von der täglichen Termin-E-Mail deaktiviert und wieder aktiviert werden. Der Versand läuft nach dem Speichern im Hintergrund; einzelne SMTP-Fehler verhindern die Veröffentlichung der Meldung nicht.

## Datenspeicherung

Seit Version 3.0 speichert die Anwendung in einer PostgreSQL-Datenbank, die als eigener Dienst (`db`) in der Compose-Datei läuft und ihre Daten im benannten Volume `rollout-planer-db` hält. Der Zugang wird über `POSTGRES_USER`, `POSTGRES_PASSWORD` und `POSTGRES_DB` in der `.env` gesetzt; `docker compose` baut daraus die `DATABASE_URL` der Anwendung.

Gespeichert werden:

- Termine für die fünf angezeigten Planungstage (Tabelle `appointments`)
- Profile von Personen, die sich mindestens einmal erfolgreich angemeldet haben (Tabelle `users`)
- veröffentlichte Änderungsmeldungen und der profilspezifische Lesestatus (Tabellen `change_notices` und `change_notice_reads`)
- gemeldete Altgeräte-Hostnames inklusive optionalem Namen und Austragungsstatus (Tabelle `old_device_hostnames`)
- Konfigurationen der öffentlichen Termin-Dashboards (Tabelle `public_dashboards`)
- Profilbilder im Unterordner `avatars` des Docker-Volumes `rollout-planer-data` (`/app/data`)

### Historie pro Tag

Vergangene, aus dem Planungsfenster fallende oder gelöschte Termine werden nicht mehr verworfen, sondern vor dem Entfernen archiviert: Für jeden Tag gibt es eine eigene Tabelle `history_JJJJ_MM_TT` (z. B. `history_2026_07_20`). Jede Zeile enthält Termin-ID, Uhrzeit (`start_time`/`end_time`), Terminname, die zuletzt zugewiesene Person (ID, Anmeldename und Anzeigename als Momentaufnahme), die erstellende Person, den Zeitpunkt der Archivierung und den Grund (`abgelaufen`, `planungsfenster`, `gelöscht`, `dev-bereinigung`). Darauf lässt sich später eine Administrationshistorie aufsetzen.

### Migration von Version 2

Beim ersten Start mit leerer Datenbank importiert die Anwendung einen vorhandenen Stand aus `/app/data/rollout-state.json` (alle bisherigen `schemaVersion`-Stände 1–4) automatisch in PostgreSQL und benennt die Datei danach in `rollout-state.json.migrated` um. Die JSON-Datei wird nicht mehr beschrieben; das Volume `rollout-planer-data` wird weiterhin für Profilbilder und diese Sicherung benötigt.

Die Anwendung ist für genau eine Container-Instanz ausgelegt; mehrere parallele App-Replikate dürfen nicht dieselbe Datenbank verwenden.

### Datenbank-Backup

Das Skript `backup.sh` erstellt bei laufender Anwendung einen konsistenten, komprimierten PostgreSQL-Dump. Gesichert werden:

- alle aktuell eingetragenen Termine (`appointments`),
- alle Tages-Historientabellen (`history_YYYY_MM_DD`),
- die Profilzeilen (`users`), weil Namen, Zuordnungen und `stats_adjustment` für die Statistik benötigt werden.

Profilbilder und andere Daten aus dem Volume `rollout-planer-data` gehören bewusst nicht zu diesem Backup. Die Vorbereitungsrolle wird zwar zusammen mit der Profilzeile gespeichert, ist für die Wiederherstellung der Statistik aber ohne Bedeutung.

Einmalig ausführbar machen und anschließend starten:

```bash
chmod +x backup.sh restore.sh
./backup.sh
```

Standardmäßig landen die Dumps in `./backups` und werden nicht automatisch gelöscht. Zielverzeichnis und Aufbewahrungsdauer lassen sich beispielsweise so setzen:

```bash
BACKUP_DIR=/srv/backups/rollout BACKUP_RETENTION_DAYS=30 ./backup.sh
```

Für einen täglichen Lauf um 02:15 Uhr kann auf dem Server ein Cron-Eintrag verwendet werden (Pfad anpassen):

```cron
15 2 * * * cd /opt/rollout && BACKUP_DIR=/srv/backups/rollout BACKUP_RETENTION_DAYS=30 ./backup.sh >> /var/log/rollout-backup.log 2>&1
```

Das Skript prüft den Dump nach der Erstellung und legt, falls `sha256sum` vorhanden ist, zusätzlich eine Prüfsummendatei an. Eine gesetzte Aufbewahrungsdauer löscht ausschließlich passend benannte Backup-Dateien, die älter als die angegebene Anzahl Tage sind.

Das Restore-Skript prüft den Dump, erstellt ein zusätzliches Sicherheitsbackup des aktuellen Stands und stoppt/startet die Anwendung automatisch:

```bash
./restore.sh backups/rollout_YYYYMMDD_HHMMSS.dump
```

Die Wiederherstellung ersetzt die im Dump enthaltenen Tabellen. Vor einem Restore sollte daher immer zusätzlich ein aktuelles Backup erstellt werden.

## Befehle

```powershell
pnpm typecheck
pnpm test
pnpm build
docker compose logs -f rollout-planer
docker compose down
```

`docker compose down` entfernt das Daten-Volume nicht. Ein Volume wird nur mit einer ausdrücklich zusätzlich angegebenen Volume-Option gelöscht.
