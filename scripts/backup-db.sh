#!/bin/bash
set -e

# ─── Config ───────────────────────────────────────────────────────────────────
CONTAINER="fnf_postgres"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-fnf_social_analyser}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
BACKUP_DIR="${PROJECT_DIR}/backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/fnf_backup_${TIMESTAMP}.sql"

# ─── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log()  { echo -e "${GREEN}[backup]${NC} $1"; }
warn() { echo -e "${YELLOW}[backup]${NC} $1"; }
fail() { echo -e "${RED}[backup]${NC} $1"; exit 1; }

# ─── Check container ──────────────────────────────────────────────────────────
log "Checking Postgres container is running..."
docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$" || fail "Container '${CONTAINER}' is not running. Run: docker compose up -d"

# ─── Create backup dir ────────────────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

# ─── Backup ───────────────────────────────────────────────────────────────────
log "Backing up '${DB_NAME}' to ${BACKUP_FILE}..."
docker exec "${CONTAINER}" pg_dump -U "${DB_USER}" --clean --if-exists "${DB_NAME}" > "${BACKUP_FILE}"

LINES=$(wc -l < "${BACKUP_FILE}")
SIZE=$(du -sh "${BACKUP_FILE}" | cut -f1)
log "Backup complete — ${LINES} lines, ${SIZE}"

# ─── Verify backup is non-empty ───────────────────────────────────────────────
if [ "${LINES}" -lt 10 ]; then
  fail "Backup file looks too small (${LINES} lines) — aborting."
fi

# ─── Row counts ───────────────────────────────────────────────────────────────
log "Row counts at time of backup:"
for TABLE in posts products post_product_links instagram_tokens; do
  COUNT=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "SELECT COUNT(*) FROM ${TABLE};" 2>/dev/null || echo "N/A")
  echo "  ${TABLE}: ${COUNT}"
done

# ─── Retention: keep last 10 backups ─────────────────────────────────────────
BACKUP_COUNT=$(ls -1 "${BACKUP_DIR}"/fnf_backup_*.sql 2>/dev/null | wc -l)
if [ "${BACKUP_COUNT}" -gt 10 ]; then
  warn "More than 10 backups found — removing oldest..."
  ls -1t "${BACKUP_DIR}"/fnf_backup_*.sql | tail -n +11 | xargs rm -f
  log "Old backups removed."
fi

log "Done. Backup saved to: ${BACKUP_FILE}"
