#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

PROGRAM_NAME="$(basename "$0")"
readonly PROGRAM_NAME
readonly RESTORE_SERVICE="postgres-restore"
readonly RESTORE_MARKER="idea2screenplay-isolated-restore-v1"

COMPOSE_FILE="docker-compose.restore.yml"
ENV_FILE=""
PROJECT_NAME=""
DATABASE_NAME=""
MANIFEST_FILE=""
MIGRATIONS_DIR="apps/api/prisma/migrations"
READY_SERVICE=""

usage() {
  cat <<'USAGE'
Usage: sudo scripts/verify-postgres-restore.sh [options]

Verify an already restored, explicitly isolated PostgreSQL target. Production
projects, production volumes, unmarked containers and non-_restore databases
are rejected before any query is run.

Required:
  --env-file PATH             Restore environment file.
  --project-name NAME         Explicit isolated Compose project; must contain
                              "restore" and must not be idea2screenplay-prod.
  --database NAME             Exact target DB; must end in _restore.
  --manifest PATH             Manifest paired with the backup dump.

Options:
  --compose-file PATH         Default: docker-compose.restore.yml.
  --migrations-dir PATH       Default: apps/api/prisma/migrations.
  --ready-service NAME        Also require the marked `api-restore` service to
                              return HTTP 2xx from /api/health/ready.
  -h, --help                  Show this help.
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
    --manifest)
      require_value "$@"; MANIFEST_FILE="$2"; shift 2 ;;
    --migrations-dir)
      require_value "$@"; MIGRATIONS_DIR="$2"; shift 2 ;;
    --ready-service)
      require_value "$@"; READY_SERVICE="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      die "unknown argument: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "run as root"
[[ -n "$ENV_FILE" && -n "$PROJECT_NAME" && -n "$DATABASE_NAME" && -n "$MANIFEST_FILE" ]] || die "missing required argument; run with --help"
[[ "$PROJECT_NAME" != "idea2screenplay-prod" ]] || die "production Compose project is forbidden"
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ && "$PROJECT_NAME" == *restore* ]] || die "project name must explicitly contain 'restore'"
[[ "$DATABASE_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*_restore$ ]] || die "target database must end in _restore"
[[ -f "$COMPOSE_FILE" && -f "$ENV_FILE" && -f "$MANIFEST_FILE" ]] || die "Compose, env or manifest file not found"
[[ -d "$MIGRATIONS_DIR" ]] || die "migrations directory not found: $MIGRATIONS_DIR"

for dependency in docker stat diff sort mktemp grep; do
  command -v "$dependency" >/dev/null 2>&1 || die "missing dependency: $dependency"
done
[[ -z "$READY_SERVICE" || "$READY_SERVICE" == "api-restore" ]] || die "the only allowed ready service is 'api-restore'"

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
  die "production PostgreSQL volume detected; refusing restore verification"
fi
grep -Eq 'restore[^|]*\|/var/lib/postgresql/data$' <<<"$mount_report" || die "target data volume is not explicitly named as restore-only"

actual_database="$(docker exec -i "$container_id" sh -ceu \
  'exec psql -X --no-psqlrc --no-password --tuples-only --no-align --set ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -c "SELECT current_database()"' \
  | tr -d '[:space:]')"
[[ "$actual_database" == "$DATABASE_NAME" ]] || die "target database mismatch: expected '$DATABASE_NAME', got '$actual_database'"

docker exec -i "$container_id" sh -ceu \
  'exec pg_isready --quiet --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' || die "restored PostgreSQL is not ready"

tmp_dir="$(mktemp -d)"
cleanup() { rm -rf -- "$tmp_dir"; }
trap cleanup EXIT INT TERM HUP

query_file="$tmp_dir/verify.sql"
cat >"$query_file" <<'SQL'
SELECT 'migration.' || migration_name || '=applied'
FROM "_prisma_migrations"
WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
ORDER BY migration_name;
SELECT 'failed_migrations=' || count(*)
FROM "_prisma_migrations"
WHERE finished_at IS NULL OR rolled_back_at IS NOT NULL;
SELECT 'core.AnonymousVisitor=' || count(*) FROM "AnonymousVisitor";
SELECT 'core.Project=' || count(*) FROM "Project";
SELECT 'core.GenerationVersion=' || count(*) FROM "GenerationVersion";
SELECT 'core.GenerationJob=' || count(*) FROM "GenerationJob";
SELECT 'core.GenerationJobEvent=' || count(*) FROM "GenerationJobEvent";
SELECT 'core.GenerationRun=' || count(*) FROM "GenerationRun";
SELECT 'core.GenerationProviderCall=' || count(*) FROM "GenerationProviderCall";
SELECT 'core.Character=' || count(*) FROM "Character";
SELECT 'core.CharacterRelationship=' || count(*) FROM "CharacterRelationship";
SELECT 'core.Location=' || count(*) FROM "Location";
SELECT 'core.Beat=' || count(*) FROM "Beat";
SELECT 'core.Scene=' || count(*) FROM "Scene";
SELECT 'core.TrendTopic=' || count(*) FROM "TrendTopic";
SELECT 'core.TrendObservation=' || count(*) FROM "TrendObservation";
SELECT 'core.DailyVisitorQuota=' || count(*) FROM "DailyVisitorQuota";
SELECT 'core.DailyIpQuota=' || count(*) FROM "DailyIpQuota";
SELECT 'core.GlobalDailyGenerationQuota=' || count(*) FROM "GlobalDailyGenerationQuota";
SELECT 'core.GlobalMonthlyGenerationQuota=' || count(*) FROM "GlobalMonthlyGenerationQuota";
SELECT 'foreign_key_constraints=' || count(*)
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public' AND c.contype = 'f';
SELECT 'foreign_keys_unvalidated=' || count(*)
FROM pg_constraint c
JOIN pg_namespace n ON n.oid = c.connamespace
WHERE n.nspname = 'public' AND c.contype = 'f' AND NOT c.convalidated;
SQL

docker exec -i "$container_id" sh -ceu \
  'exec psql -X --no-psqlrc --no-password --tuples-only --no-align --set ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
  <"$query_file" >"$tmp_dir/restored.txt"

grep '^migration\.' "$MANIFEST_FILE" | sort >"$tmp_dir/manifest-migrations.txt"
grep '^migration\.' "$tmp_dir/restored.txt" | sort >"$tmp_dir/restored-migrations.txt"
diff -u "$tmp_dir/manifest-migrations.txt" "$tmp_dir/restored-migrations.txt" >/dev/null || die "restored migration set differs from the backup manifest"

: >"$tmp_dir/repo-migrations.txt"
for migration_path in "$MIGRATIONS_DIR"/*; do
  [[ -d "$migration_path" ]] || continue
  migration_name="$(basename "$migration_path")"
  [[ "$migration_name" =~ ^[A-Za-z0-9_-]+$ ]] || die "invalid migration directory name: $migration_name"
  printf 'migration.%s=applied\n' "$migration_name" >>"$tmp_dir/repo-migrations.txt"
done
sort -o "$tmp_dir/repo-migrations.txt" "$tmp_dir/repo-migrations.txt"
diff -u "$tmp_dir/repo-migrations.txt" "$tmp_dir/restored-migrations.txt" >/dev/null || die "restored migration set differs from the repository"

grep '^core\.' "$MANIFEST_FILE" | sort >"$tmp_dir/manifest-counts.txt"
grep '^core\.' "$tmp_dir/restored.txt" | sort >"$tmp_dir/restored-counts.txt"
diff -u "$tmp_dir/manifest-counts.txt" "$tmp_dir/restored-counts.txt" >/dev/null || die "restored core table counts differ from the backup manifest"

source_fk_count="$(grep '^foreign_key_constraints=' "$MANIFEST_FILE")"
restored_fk_count="$(grep '^foreign_key_constraints=' "$tmp_dir/restored.txt")"
[[ -n "$source_fk_count" && "$source_fk_count" == "$restored_fk_count" ]] || die "foreign-key constraint count differs from source"
grep -qx 'failed_migrations=0' "$tmp_dir/restored.txt" || die "restored database has incomplete or rolled-back migrations"
grep -qx 'foreign_keys_unvalidated=0' "$tmp_dir/restored.txt" || die "restored database has unvalidated foreign keys"

if [[ -n "$READY_SERVICE" ]]; then
  mapfile -t ready_services < <("${compose[@]}" --profile api config --services | awk -v wanted="$READY_SERVICE" '$0 == wanted')
  [[ ${#ready_services[@]} -eq 1 ]] || die "Compose must contain exactly one '$READY_SERVICE' service"
  mapfile -t ready_container_ids < <("${compose[@]}" --profile api ps -q "$READY_SERVICE" | sed '/^[[:space:]]*$/d')
  [[ ${#ready_container_ids[@]} -eq 1 ]] || die "expected exactly one running '$READY_SERVICE' container"
  ready_container_id="${ready_container_ids[0]}"
  ready_project="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$ready_container_id")"
  ready_compose_service="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$ready_container_id")"
  ready_marker="$(docker inspect --format '{{ index .Config.Labels "com.idea2screenplay.restore-api" }}' "$ready_container_id")"
  [[ "$ready_project" == "$PROJECT_NAME" && "$ready_compose_service" == "$READY_SERVICE" ]] || die "isolated API Compose identity mismatch"
  [[ "$ready_marker" == "idea2screenplay-isolated-api-v1" ]] || die "API lacks the isolated-restore marker"

  api_ready="no"
  for _ in {1..60}; do
    if docker exec -i "$ready_container_id" node -e \
      "fetch('http://127.0.0.1:3000/api/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" \
      >/dev/null 2>&1; then
      api_ready="yes"
      break
    fi
    sleep 1
  done
  [[ "$api_ready" == "yes" ]] || die "isolated API readiness check failed after 60 seconds"
fi

project_count="$(grep '^core.Project=' "$tmp_dir/restored.txt" | cut -d= -f2)"
visitor_count="$(grep '^core.AnonymousVisitor=' "$tmp_dir/restored.txt" | cut -d= -f2)"
migration_count="$(wc -l <"$tmp_dir/restored-migrations.txt" | tr -d '[:space:]')"
fk_count="${restored_fk_count#*=}"

trap - EXIT INT TERM HUP
rm -rf -- "$tmp_dir"
printf 'Restore verification PASS: database=%s migrations=%s projects=%s visitors=%s foreign_keys=%s db_ready=yes' \
  "$DATABASE_NAME" "$migration_count" "$project_count" "$visitor_count" "$fk_count"
if [[ -n "$READY_SERVICE" ]]; then
  printf ' api_ready=yes'
fi
printf '\n'
