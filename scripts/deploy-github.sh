#!/usr/bin/env bash
# Invoked through SSH stdin by the workflow; does not depend on an installed copy.
set -Eeuo pipefail
umask 077

die() { printf 'Deployment refused: %s\n' "$*" >&2; exit 1; }
target="${1:-}"
[[ "$target" =~ ^[0-9a-f]{40}$ ]] || die 'expected one full Git commit SHA'
[[ $# -eq 1 ]] || die 'expected one argument'
[[ $(id -u) -eq 0 ]] || die 'this existing deployment requires root'
root=/opt/Idea2Screenplay-source
cd "$root"
[[ -d .git && -f .env.production ]] || die 'missing Git checkout or production environment'
exec 8>/var/lock/idea2screenplay-deploy.lock
flock -n 8 || die 'another deployment is running'
[[ -z $(git status --porcelain) ]] || die 'server checkout has local changes'
[[ $(git branch --show-current) == master ]] || die 'server branch must be master'
export GIT_TERMINAL_PROMPT=0
export GIT_SSH_COMMAND='ssh -i /root/.ssh/idea2screenplay-github -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes'
git fetch --no-tags github +refs/heads/master:refs/remotes/github/master
[[ $(git rev-parse refs/remotes/github/master) == "$target" ]] || die 'superseded run: master has changed; deploy the latest run'
git merge-base --is-ancestor HEAD "$target" || die 'server and GitHub histories diverged'
previous=$(git rev-parse HEAD)
printf 'Previous source: %s\nTarget source: %s\n' "$previous" "$target"

compose=(docker compose --project-name idea2screenplay-prod --env-file .env.production -f docker-compose.prod.yml)
"${compose[@]}" config --quiet
postgres_id=$("${compose[@]}" ps -q postgres)
[[ -n "$postgres_id" ]] || die 'existing postgres is not running'
[[ $(docker inspect --format '{{.State.Health.Status}}' "$postgres_id") == healthy ]] || die 'postgres is not healthy'
# Resolve the actual database name without exposing connection credentials.
database=$(docker exec "$postgres_id" sh -c 'printf "%s" "$POSTGRES_DB"')
# Back up on every attempt, including retry of the same commit.
bash scripts/backup-postgres.sh --database "$database" --keep 7

git merge --ff-only "$target"
"${compose[@]}" config --quiet
# Build serially to reduce peak memory on the 2-core / 4-GiB server.
# The existing running containers remain in place if either build fails.
"${compose[@]}" build api
"${compose[@]}" build web
# Do not recreate postgres, remove volumes, or touch other Compose projects.
# Always recreate web so nginx resolves the newly started API container address.
"${compose[@]}" up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 api
"${compose[@]}" up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 web
[[ $("${compose[@]}" ps -q postgres) == "$postgres_id" ]] || die 'postgres container changed unexpectedly'
# Verify traffic through nginx, not just individual container health checks.
"${compose[@]}" exec -T web wget -q -O /dev/null --no-check-certificate https://127.0.0.1/api/health/ready
printf 'Deployment healthy: %s\n' "$target"
# Prisma migrations are applied by the API image at startup. No automatic database rollback.
