#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

PROGRAM_NAME="$(basename "$0")"
readonly PROGRAM_NAME
readonly RESTORE_SERVICE="postgres-restore"
readonly RESTORE_MARKER="idea2screenplay-isolated-restore-v1"
readonly CONFIRM_TEXT="RESTORE-INTO-ISOLATED-TARGET"

COMPOSE_FILE="docker-compose.restore.yml"
ENV_FILE=""
PROJECT_NAME=""
DATABASE_NAME=""
BACKUP_FILE=""
MIGRATIONS_DIR="apps/api/prisma/migrations"
CONFIRMATION=""

usage() {
  cat <<'USAGE'
Usage: sudo scripts/restore-postgres.sh [options]

Restore one verified custom-format backup into a fresh, empty and explicitly
marked isolated target. This script cannot restore over production or a
non-empty database.

Required:
  --backup PATH              .dump file; adjacent .manifest and .sha256 required.
  --env-file PATH            Restore-only environment file.
  --project-name NAME        Explicit project containing "restore" and not
                             idea2screenplay-prod.
  --database NAME            Exact target DB, ending in _restore.
  --confirm TEXT             Must equal RESTORE-INTO-ISOLATED-TARGET.

Options:
  --compose-file PATH        Default: docker-compose.restore.yml.
  --migrations-dir PATH      Default: apps/api/prisma/migrations.
  -h, --help                 Show this help.
USAGE
}

die() {
  printf '%s: ERROR: %s\n' "$PROGRAM_NAME" "$*" >&2
  exit 1
}

require_value() {
  [[ $# -ge 2 && -n "$2" ]] || die "$1 requires a value"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --compose-file)
      require_value "$@"; COMPOSE_FILE="$2"; shift 2 ;;
    --env-file)
      require_value "$@"; ENV_FILE="$2"; shift 2 ;;
    --project-name)
      require_value "$@"; PROJECT_NAME="$2"; shift 2 ;;
    --database)
      require_value "$@"; DATABASE_NAME="$2"; shift 2 ;;
    --backup)
      require_value "$@"; BACKUP_FILE="$2"; shift 2 ;;
    --migrations-dir)
      require_value "$@"; MIGRATIONS_DIR="$2"; shift 2 ;;
    --confirm)
      require_value "$@"; CONFIRMATION="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      die "unknown argument: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "run as root"
[[ -n "$ENV_FILE" && -n "$PROJECT_NAME" && -n "$DATABASE_NAME" && -n "$BACKUP_FILE" ]] || die "missing required argument; run with --help"
[[ "$CONFIRMATION" == "$CONFIRM_TEXT" ]] || die "explicit --confirm $CONFIRM_TEXT is required"
[[ "$PROJECT_NAME" != "idea2screenplay-prod" ]] || die "production Compose project is forbidden"
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ && "$PROJECT_NAME" == *restore* ]] || die "project name must explicitly contain 'restore'"
[[ "$DATABASE_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*_restore$ ]] || die "target database must end in _restore"
[[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" && -f "$BACKUP_FILE" ]] || die "Compose, env or backup file not found"
[[ -d "$MIGRATIONS_DIR" ]] || die "migrations directory not found"

for dependency in docker sha256sum stat grep realpath; do
  command -v "$dependency" >/dev/null 2>&1 || die "missing dependency: $dependency"
done

backup_name="$(basename "$BACKUP_FILE")"
[[ "$backup_name" =~ ^idea2screenplay_[0-9]{8}T[0-9]{6}Z\.dump$ ]] || die "unexpected backup filename"
[[ ! -L "$BACKUP_FILE" ]] || die "backup file must not be a symbolic link"
BACKUP_FILE="$(realpath "$BACKUP_FILE")"
manifest_file="$BACKUP_FILE.manifest"
checksum_file="$BACKUP_FILE.sha256"
[[ -f "$manifest_file" && -f "$checksum_file" ]] || die "backup manifest or checksum is missing"

for protected_file in "$BACKUP_FILE" "$manifest_file" "$checksum_file"; do
  [[ ! -L "$protected_file" ]] || die "backup set must not contain symbolic links"
  [[ "$(stat -c '%u' "$protected_file")" -eq 0 ]] || die "backup set must be root-owned"
  mode=$(( 8#$(stat -c '%a' "$protected_file") ))
  (( (mode & 8#077) == 0 )) || die "backup set must not be accessible by group or others"
done

mapfile -t checksum_lines <"$checksum_file"
[[ ${#checksum_lines[@]} -eq 2 ]] || die "checksum file must contain exactly two SHA-256 entries"
checksum_entries=()
for checksum_line in "${checksum_lines[@]}"; do
  [[ "$checksum_line" =~ ^[0-9a-f]{64}[[:space:]]+([^[:space:]]+)$ ]] || die "checksum file contains a malformed entry"
  checksum_entries+=("${BASH_REMATCH[1]}")
done
[[ "${checksum_entries[0]}" == "$backup_name" && "${checksum_entries[1]}" == "$backup_name.manifest" ]] || die "checksum file contains unexpected paths"

(
  cd "$(dirname "$BACKUP_FILE")"
  sha256sum --check --strict "$(basename "$checksum_file")"
) >/dev/null || die "SHA-256 verification failed"

grep -qx 'format=postgresql-custom' "$manifest_file" || die "manifest is not a PostgreSQL custom-format backup"
grep -qx "database=.*" "$manifest_file" || die "manifest lacks source database metadata"

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")
mapfile -t matching_services < <("${compose[@]}" config --services | awk -v wanted="$RESTORE_SERVICE" '$0 == wanted')
[[ ${#matching_services[@]} -eq 1 ]] || die "Compose must contain exactly one service named '$RESTORE_SERVICE'"
mapfile -t container_ids < <("${compose[@]}" ps -q "$RESTORE_SERVICE" | sed '/^[[:space:]]*$/d')
[[ ${#container_ids[@]} -eq 1 ]] || die "expected exactly one running '$RESTORE_SERVICE' container"
container_id="${container_ids[0]}"

actual_project="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id")"
actual_service="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$container_id")"
restore_marker="$(docker inspect --format '{{ index .Config.Labels "com.idea2screenplay.restore-target" }}' "$container_id")"
[[ "$actual_project" == "$PROJECT_NAME" ]] || die "container project mismatch"
[[ "$actual_service" == "$RESTORE_SERVICE" ]] || die "container service mismatch"
[[ "$restore_marker" == "$RESTORE_MARKER" ]] || die "container lacks the isolated-restore marker"

mount_report="$(docker inspect --format '{{range .Mounts}}{{printf "%s|%s\n" .Name .Destination}}{{end}}' "$container_id")"
if grep -q 'idea2screenplay_prod_pgdata' <<<"$mount_report"; then
  die "production PostgreSQL volume detected; refusing restore"
fi
grep -Eq 'restore[^|]*\|/var/lib/postgresql/data$' <<<"$mount_report" || die "target data volume is not explicitly named as restore-only"

actual_database="$(docker exec -i "$container_id" sh -ceu \
  'exec psql -X --no-psqlrc --no-password --tuples-only --no-align --set ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -c "SELECT current_database()"' \
  | tr -d '[:space:]')"
[[ "$actual_database" == "$DATABASE_NAME" ]] || die "target database mismatch: expected '$DATABASE_NAME', got '$actual_database'"

public_table_count="$(docker exec -i "$container_id" sh -ceu \
  'exec psql -X --no-psqlrc --no-password --tuples-only --no-align --set ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -c "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname = '\''public'\'' AND c.relkind IN ('\''r'\'', '\''p'\'')"' \
  | tr -d '[:space:]')"
[[ "$public_table_count" == "0" ]] || die "target database is not empty; create a fresh isolated volume"

docker exec -i "$container_id" pg_restore --list <"$BACKUP_FILE" >/dev/null || die "pg_restore cannot parse the archive"

printf 'Restoring backup=%s into isolated project=%s service=%s database=%s\n' \
  "$backup_name" "$PROJECT_NAME" "$RESTORE_SERVICE" "$DATABASE_NAME"
docker exec -i "$container_id" sh -ceu \
  'exec pg_restore --exit-on-error --single-transaction --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  <"$BACKUP_FILE"

verify_args=(
  --compose-file "$COMPOSE_FILE"
  --env-file "$ENV_FILE"
  --project-name "$PROJECT_NAME"
  --database "$DATABASE_NAME"
  --manifest "$manifest_file"
  --migrations-dir "$MIGRATIONS_DIR"
)
"$(dirname "$0")/verify-postgres-restore.sh" "${verify_args[@]}"
