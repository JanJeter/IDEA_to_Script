#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

PROGRAM_NAME="$(basename "$0")"
ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
PROJECT_NAME="idea2screenplay-prod"
DATABASE_NAME="idea2screenplay"
BACKUP_DIR="/var/backups/idea2screenplay/postgres"
SKIP_BUILD="no"

die() {
  printf '%s: ERROR: %s\n' "$PROGRAM_NAME" "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: sudo scripts/deploy-ecs.sh [options]

Pull the fast-forward-only master branch from Gitee, back up PostgreSQL,
build the production images, restart Compose, and verify health checks.

Options:
  --skip-build   Reuse existing images. Only use for a config-only restart.
  -h, --help     Show this help.
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[[ "$(id -u)" -eq 0 ]] || die "run as root"
[[ -d "$ROOT_DIR/.git" ]] || die "not a Git checkout: $ROOT_DIR"
[[ -f "$ROOT_DIR/$ENV_FILE" ]] || die "missing $ROOT_DIR/$ENV_FILE"
command -v git >/dev/null 2>&1 || die "git is required"
command -v docker >/dev/null 2>&1 || die "docker is required"

cd -- "$ROOT_DIR"
compose=(docker compose --project-name "$PROJECT_NAME" --env-file "$ENV_FILE" -f "$COMPOSE_FILE")

if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  die "working tree is not clean; commit or move local changes before deploying"
fi

old_commit="$(git rev-parse HEAD)"
printf 'Current commit: %s\n' "$old_commit"
git fetch --prune origin master
git merge --ff-only origin/master
new_commit="$(git rev-parse HEAD)"
printf 'Target commit:  %s\n' "$new_commit"

if [[ "$SKIP_BUILD" != "yes" && "$old_commit" != "$new_commit" ]]; then
  printf 'Starting verified PostgreSQL backup before deployment\n'
  "$ROOT_DIR/scripts/backup-postgres.sh" \
    --compose-file "$ROOT_DIR/$COMPOSE_FILE" \
    --env-file "$ROOT_DIR/$ENV_FILE" \
    --project-name "$PROJECT_NAME" \
    --database "$DATABASE_NAME" \
    --backup-dir "$BACKUP_DIR" \
    --keep 7
fi

if [[ "$SKIP_BUILD" != "yes" ]]; then
  "${compose[@]}" build
fi
"${compose[@]}" up -d

printf 'Waiting for services to become healthy\n'
for attempt in $(seq 1 40); do
  api_status="$("${compose[@]}" ps -q api | xargs -r docker inspect --format '{{.State.Health.Status}}' 2>/dev/null || true)"
  web_status="$("${compose[@]}" ps -q web | xargs -r docker inspect --format '{{.State.Health.Status}}' 2>/dev/null || true)"
  postgres_status="$("${compose[@]}" ps -q postgres | xargs -r docker inspect --format '{{.State.Health.Status}}' 2>/dev/null || true)"
  if [[ "$api_status" == "healthy" && "$web_status" == "healthy" && "$postgres_status" == "healthy" ]]; then
    printf 'Deployment healthy: %s\n' "$new_commit"
    exit 0
  fi
  printf '  %s/40 api=%s web=%s postgres=%s\n' "$attempt" "${api_status:-missing}" "${web_status:-missing}" "${postgres_status:-missing}"
  sleep 3
done

printf 'Deployment failed health checks. Recent service logs:\n' >&2
"${compose[@]}" ps >&2 || true
"${compose[@]}" logs --tail=80 api web postgres >&2 || true
die "deployment did not become healthy"
