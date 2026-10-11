#!/bin/bash
set -e

# ─── Config ───────────────────────────────────────────────────────────────────
CONTAINER="fnf_postgres"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-fnf_social_analyser}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"
BACKUP_DIR="${PROJECT_DIR}/backups"

# ─── Colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

log()  { echo -e "${GREEN}[restore]${NC} $1"; }
warn() { echo -e "${YELLOW}[restore]${NC} $1"; }
fail() { echo -e "${RED}[restore]${NC} $1"; exit 1; }
info() { echo -e "${CYAN}[restore]${NC} $1"; }

# ─── Check container ──────────────────────────────────────────────────────────
log "Checking Postgres container is running..."
docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$" || fail "Container '${CONTAINER}' is not running. Run: docker compose up -d"

# ─── List available backups ───────────────────────────────────────────────────
BACKUPS=($(ls -1t "${BACKUP_DIR}"/fnf_backup_*.sql 2>/dev/null))

if [ ${#BACKUPS[@]} -eq 0 ]; then
  fail "No backups found in ${BACKUP_DIR}. Run: yarn db:backup"
fi

# ─── Select backup ────────────────────────────────────────────────────────────
# If a file path is passed as argument, use it directly
if [ -n "$1" ]; then
  BACKUP_FILE="$1"
  [ -f "${BACKUP_FILE}" ] || fail "File not found: ${BACKUP_FILE}"
else
  # Show numbered list of available backups
  echo ""
  info "Available backups (newest first):"
  echo ""
  for i in "${!BACKUPS[@]}"; do
    FILE="${BACKUPS[$i]}"
    SIZE=$(du -sh "${FILE}" | cut -f1)
    FILENAME=$(basename "${FILE}")
    echo "  [$((i+1))] ${FILENAME}  (${SIZE})"
  done
  echo ""

  read -p "Select backup number [1]: " SELECTION
  SELECTION="${SELECTION:-1}"

  # Validate selection
  if ! [[ "${SELECTION}" =~ ^[0-9]+$ ]] || [ "${SELECTION}" -lt 1 ] || [ "${SELECTION}" -gt "${#BACKUPS[@]}" ]; then
    fail "Invalid selection: ${SELECTION}"
  fi

  BACKUP_FILE="${BACKUPS[$((SELECTION-1))]}"
fi

log "Selected: $(basename "${BACKUP_FILE}")"

# ─── Show current row counts before restore ───────────────────────────────────
info "Current row counts (before restore):"
for TABLE in posts products post_product_links instagram_tokens; do
  COUNT=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "SELECT COUNT(*) FROM ${TABLE};" 2>/dev/null || echo "N/A")
  echo "  ${TABLE}: ${COUNT}"
done
echo ""

# ─── Confirm ──────────────────────────────────────────────────────────────────
warn "This will OVERWRITE all current data in '${DB_NAME}' with the selected backup."
read -p "Continue? (y/N) " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] || { warn "Aborted."; exit 0; }

# ─── Restore ──────────────────────────────────────────────────────────────────
log "Restoring from $(basename "${BACKUP_FILE}")..."
docker exec -i "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" < "${BACKUP_FILE}"
log "Restore complete."

# ─── Verify row counts after restore ─────────────────────────────────────────
info "Row counts after restore:"
for TABLE in posts products post_product_links instagram_tokens; do
  COUNT=$(docker exec "${CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "SELECT COUNT(*) FROM ${TABLE};" 2>/dev/null || echo "N/A")
  echo "  ${TABLE}: ${COUNT}"
done

log "Done."
