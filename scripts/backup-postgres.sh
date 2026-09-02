#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

PROGRAM_NAME="$(basename "$0")"
readonly PROGRAM_NAME
readonly POSTGRES_SERVICE="postgres"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
PROJECT_NAME="idea2screenplay-prod"
DATABASE_NAME=""
BACKUP_DIR="/var/backups/idea2screenplay/postgres"
KEEP_COUNT=7

usage() {
  cat <<'USAGE'
Usage: sudo scripts/backup-postgres.sh --database NAME [options]

Create a verified PostgreSQL custom-format backup from the exact `postgres`
service in a Compose project. The script never reads or prints the password.

Required:
  --database NAME       Expected POSTGRES_DB inside the container.

Options:
  --compose-file PATH   Compose file (default: docker-compose.prod.yml).
  --env-file PATH       Compose environment file (default: .env.production).
  --project-name NAME   Compose project (default: idea2screenplay-prod).
  --backup-dir PATH     Absolute destination (default:
                        /var/backups/idea2screenplay/postgres).
  --keep COUNT          Number of complete backups retained (default: 7).
  -h, --help            Show this help.
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
    --backup-dir)
      require_value "$@"; BACKUP_DIR="$2"; shift 2 ;;
    --keep)
      require_value "$@"; KEEP_COUNT="$2"; shift 2 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      die "unknown argument: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "run as root so backup files remain root-only"
[[ -n "$DATABASE_NAME" ]] || die "--database is required"
[[ "$DATABASE_NAME" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || die "invalid database name"
[[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "invalid Compose project name"
[[ "$KEEP_COUNT" =~ ^[1-9][0-9]*$ ]] || die "--keep must be a positive integer"
(( KEEP_COUNT <= 365 )) || die "--keep must not exceed 365"
[[ "$BACKUP_DIR" == /* && "$BACKUP_DIR" != "/" ]] || die "--backup-dir must be an absolute non-root path"
[[ -f "$COMPOSE_FILE" ]] || die "Compose file not found: $COMPOSE_FILE"
[[ -f "$ENV_FILE" ]] || die "environment file not found: $ENV_FILE"

for dependency in docker sha256sum sort find stat install mktemp cmp flock; do
  command -v "$dependency" >/dev/null 2>&1 || die "missing dependency: $dependency"
done

compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

mapfile -t matching_services < <("${compose[@]}" config --services | awk -v wanted="$POSTGRES_SERVICE" '$0 == wanted')
[[ ${#matching_services[@]} -eq 1 ]] || die "Compose must contain exactly one service named '$POSTGRES_SERVICE'"

mapfile -t container_ids < <("${compose[@]}" ps -q "$POSTGRES_SERVICE" | sed '/^[[:space:]]*$/d')
[[ ${#container_ids[@]} -eq 1 ]] || die "expected exactly one running '$POSTGRES_SERVICE' container"
container_id="${container_ids[0]}"

actual_project="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$container_id")"
actual_service="$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$container_id")"
[[ "$actual_project" == "$PROJECT_NAME" ]] || die "container belongs to Compose project '$actual_project', not '$PROJECT_NAME'"
[[ "$actual_service" == "$POSTGRES_SERVICE" ]] || die "container is service '$actual_service', not '$POSTGRES_SERVICE'"

actual_database="$(docker exec -i "$container_id" sh -ceu \
  'exec psql -X --no-psqlrc --no-password --tuples-only --no-align --set ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -c "SELECT current_database()"' \
  | tr -d '[:space:]')"
[[ "$actual_database" == "$DATABASE_NAME" ]] || die "database mismatch: expected '$DATABASE_NAME', container reports '$actual_database'"

if [[ -L "$BACKUP_DIR" ]]; then
  die "backup directory must not be a symbolic link"
fi
install -d -m 0700 -o root -g root -- "$BACKUP_DIR"
[[ "$(stat -c '%u' "$BACKUP_DIR")" -eq 0 ]] || die "backup directory is not root-owned"
chmod 0700 -- "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.backup.lock"
chmod 0600 "$BACKUP_DIR/.backup.lock"
flock -n 9 || die "another backup process already holds $BACKUP_DIR/.backup.lock"

timestamp="$(date -u +'%Y%m%dT%H%M%SZ')"
base_name="idea2screenplay_${timestamp}.dump"
final_dump="$BACKUP_DIR/$base_name"
final_manifest="$final_dump.manifest"
final_checksum="$final_dump.sha256"

[[ ! -e "$final_dump" && ! -e "$final_manifest" && ! -e "$final_checksum" ]] || die "backup name collision: $base_name"

tmp_dump="$(mktemp "$BACKUP_DIR/.${base_name}.partial.XXXXXX")"
tmp_manifest_before="$(mktemp "$BACKUP_DIR/.${base_name}.manifest-before.partial.XXXXXX")"
tmp_manifest="$(mktemp "$BACKUP_DIR/.${base_name}.manifest.partial.XXXXXX")"
tmp_checksum="$(mktemp "$BACKUP_DIR/.${base_name}.sha256.partial.XXXXXX")"

cleanup() {
  rm -f -- "$tmp_dump" "$tmp_manifest_before" "$tmp_manifest" "$tmp_checksum"
}
trap cleanup EXIT INT TERM HUP

write_manifest() {
  local destination="$1"
  {
    printf 'manifest_version=1\n'
    printf 'format=postgresql-custom\n'
    printf 'created_utc=%s\n' "$timestamp"
    printf 'compose_project=%s\n' "$PROJECT_NAME"
    printf 'compose_service=%s\n' "$POSTGRES_SERVICE"
    printf 'database=%s\n' "$DATABASE_NAME"
    docker exec -i "$container_id" sh -ceu \
      'exec psql -X --no-psqlrc --no-password --tuples-only --no-align --set ON_ERROR_STOP=1 --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
      <<'SQL'
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
  } >"$destination"
}

printf 'Creating custom-format backup from project=%s service=%s database=%s\n' \
  "$PROJECT_NAME" "$POSTGRES_SERVICE" "$DATABASE_NAME"

# The two manifests make counts a reliable restore baseline. If writes change a
# counted table during the dump window, nothing is published and the next run retries.
backup_ok="no"
for attempt in 1 2 3; do
  : >"$tmp_dump"
  write_manifest "$tmp_manifest_before"
  if docker exec -i "$container_id" sh -ceu \
    'exec pg_dump --format=custom --compress=9 --lock-wait-timeout=5000 --no-owner --no-privileges --username="$POSTGRES_USER" --dbname="$POSTGRES_DB"' \
    >"$tmp_dump" && [[ -s "$tmp_dump" ]] && \
    docker exec -i "$container_id" pg_restore --list <"$tmp_dump" >/dev/null; then
    write_manifest "$tmp_manifest"
    if cmp -s "$tmp_manifest_before" "$tmp_manifest"; then
      backup_ok="yes"
      break
    fi
  fi
  printf 'Backup snapshot changed or dump failed (attempt %s/3); retrying\n' "$attempt" >&2
  sleep $((attempt * 2))
done
[[ "$backup_ok" == "yes" ]] || die "could not produce a stable backup after 3 attempts"

grep -qx 'failed_migrations=0' "$tmp_manifest" || die "source has incomplete or rolled-back Prisma migrations"
grep -qx 'foreign_keys_unvalidated=0' "$tmp_manifest" || die "source has unvalidated foreign keys"

dump_hash="$(sha256sum "$tmp_dump" | awk '{print $1}')"
manifest_hash="$(sha256sum "$tmp_manifest" | awk '{print $1}')"
printf '%s  %s\n%s  %s\n' \
  "$dump_hash" "$base_name" \
  "$manifest_hash" "$base_name.manifest" >"$tmp_checksum"

chmod 0600 -- "$tmp_dump" "$tmp_manifest" "$tmp_checksum"
sync -f "$tmp_dump" "$tmp_manifest" "$tmp_checksum"

# The checksum is published last, so consumers never accept a partially published set.
mv -- "$tmp_manifest" "$final_manifest"
mv -- "$tmp_dump" "$final_dump"
mv -- "$tmp_checksum" "$final_checksum"
rm -f -- "$tmp_manifest_before"
sync -f "$BACKUP_DIR"

# Keep complete backup sets only. Paths come from a fixed prefix inside the checked directory.
mapfile -d '' -t backup_candidates < <(
  find "$BACKUP_DIR" -maxdepth 1 -type f -name 'idea2screenplay_????????T??????Z.dump' \
    -printf '%T@ %p\0' | sort -z -rn | sed -z 's/^[^ ]* //'
)
backups=()
for candidate in "${backup_candidates[@]}"; do
  if [[ -f "$candidate.manifest" && -f "$candidate.sha256" ]]; then
    backups+=("$candidate")
  fi
done
if (( ${#backups[@]} > KEEP_COUNT )); then
  for ((index = KEEP_COUNT; index < ${#backups[@]}; index += 1)); do
    old_dump="${backups[$index]}"
    rm -f -- "$old_dump.sha256" "$old_dump.manifest" "$old_dump"
  done
fi

trap - EXIT INT TERM HUP
printf 'Backup complete: %s\n' "$final_dump"
printf 'SHA-256: %s\n' "$dump_hash"
printf 'Retention: newest %s complete backup set(s)\n' "$KEEP_COUNT"
