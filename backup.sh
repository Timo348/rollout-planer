#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-0}"

if ! [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ ]]; then
  echo "Fehler: BACKUP_RETENTION_DAYS muss eine nichtnegative ganze Zahl sein." >&2
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

mkdir -p -- "${BACKUP_DIR}"
BACKUP_DIR="$(cd -- "${BACKUP_DIR}" && pwd)"

LOCK_DIR="${BACKUP_DIR}/.backup.lock"
if ! mkdir -- "${LOCK_DIR}" 2>/dev/null; then
  echo "Fehler: Es laeuft bereits ein Backup (${LOCK_DIR})." >&2
  exit 1
fi

TIMESTAMP="$(date -u +'%Y%m%d_%H%M%S')"
BACKUP_FILE="${BACKUP_DIR}/rollout_${TIMESTAMP}.dump"
if [[ -e "${BACKUP_FILE}" ]]; then
  BACKUP_FILE="${BACKUP_DIR}/rollout_${TIMESTAMP}_$$.dump"
fi
TEMP_FILE="${BACKUP_FILE}.tmp"
CHECKSUM_FILE="${BACKUP_FILE}.sha256"

cleanup() {
  rm -f -- "${TEMP_FILE}"
  rmdir -- "${LOCK_DIR}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

cd -- "${PROJECT_DIR}"

if ! docker compose ps --status running --services | grep -Fxq "db"; then
  echo "Fehler: Der Compose-Dienst 'db' laeuft nicht." >&2
  exit 1
fi

echo "Erstelle Datenbank-Backup ..."
docker compose exec -T db sh -ceu '
  exec pg_dump \
    --username="$POSTGRES_USER" \
    --dbname="$POSTGRES_DB" \
    --format=custom \
    --no-owner \
    --no-privileges \
    --table=public.users \
    --table=public.appointments \
    --table="public.history_*"
' > "${TEMP_FILE}"

if [[ ! -s "${TEMP_FILE}" ]]; then
  echo "Fehler: pg_dump hat eine leere Datei erzeugt." >&2
  exit 1
fi

docker compose exec -T db pg_restore --list < "${TEMP_FILE}" >/dev/null
mv -- "${TEMP_FILE}" "${BACKUP_FILE}"

if command -v sha256sum >/dev/null 2>&1; then
  (
    cd -- "${BACKUP_DIR}"
    sha256sum -- "$(basename -- "${BACKUP_FILE}")" > "$(basename -- "${CHECKSUM_FILE}")"
  )
fi

if (( RETENTION_DAYS > 0 )); then
  find "${BACKUP_DIR}" -maxdepth 1 -type f \
    \( -name 'rollout_*.dump' -o -name 'rollout_*.dump.sha256' \) \
    -mtime "+${RETENTION_DAYS}" -delete
fi

echo "Backup erfolgreich: ${BACKUP_FILE}"
