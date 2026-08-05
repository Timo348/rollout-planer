#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -ne 1 ]]; then
  echo "Verwendung: $0 /pfad/zum/rollout_YYYYMMDD_HHMMSS.dump" >&2
  exit 1
fi

DUMP_NAME="$(basename -- "$1")"
DUMP_DIR="$(cd -- "$(dirname -- "$1")" 2>/dev/null && pwd)" || {
  echo "Fehler: Das Verzeichnis der Backup-Datei existiert nicht." >&2
  exit 1
}
DUMP_FILE="${DUMP_DIR}/${DUMP_NAME}"

if [[ ! -f "${DUMP_FILE}" ]]; then
  echo "Fehler: Backup-Datei nicht gefunden: ${DUMP_FILE}" >&2
  exit 1
fi

command -v docker >/dev/null 2>&1 || {
  echo "Fehler: docker wurde nicht gefunden." >&2
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "Fehler: Docker Compose v2 wurde nicht gefunden." >&2
  exit 1
}

cd -- "${PROJECT_DIR}"

if ! docker compose ps --status running --services | grep -Fxq "db"; then
  echo "Fehler: Der Compose-Dienst 'db' laeuft nicht." >&2
  exit 1
fi

echo "Pruefe Backup ..."
docker compose exec -T db pg_restore --list < "${DUMP_FILE}" >/dev/null

if [[ -f "${DUMP_FILE}.sha256" ]] && command -v sha256sum >/dev/null 2>&1; then
  (
    cd -- "${DUMP_DIR}"
    sha256sum --check -- "${DUMP_NAME}.sha256"
  )
fi

echo "Erstelle vor dem Restore ein Sicherheitsbackup ..."
BACKUP_DIR="${DUMP_DIR}" BACKUP_RETENTION_DAYS=0 bash "${PROJECT_DIR}/backup.sh"

APP_WAS_RUNNING=0
if docker compose ps --status running --services | grep -Fxq "rollout-planer"; then
  APP_WAS_RUNNING=1
  docker compose stop rollout-planer
fi

restart_after_error() {
  status=$?
  trap - EXIT
  if (( APP_WAS_RUNNING )); then
    docker compose start rollout-planer >/dev/null || status=1
  fi
  echo "Restore fehlgeschlagen; die Restore-Transaktion wurde zurueckgerollt." >&2
  exit "${status}"
}
trap restart_after_error EXIT

echo "Stelle Datenbank wieder her ..."
docker compose exec -T db sh -ceu '
  exec pg_restore \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --clean \
    --if-exists \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    --single-transaction
' < "${DUMP_FILE}"

trap - EXIT

if (( APP_WAS_RUNNING )); then
  if ! docker compose start rollout-planer; then
    echo "Restore erfolgreich, aber die Anwendung konnte nicht gestartet werden." >&2
    exit 1
  fi
fi

echo "Restore erfolgreich: ${DUMP_FILE}"
