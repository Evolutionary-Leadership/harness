#!/usr/bin/env bash
# A throwaway Postgres for the integration tier on a machine with no Docker.
#
#   export TEST_DATABASE_URL=$(bash scripts/test-db.sh)   start (or adopt), print the URL
#   bash scripts/test-db.sh stop                            stop and delete the cluster
#
# When TEST_DATABASE_URL is already set, prints it and does nothing else. When
# initdb is installed, starts one cluster under ${TMPDIR:-/tmp}, trust auth on
# 127.0.0.1 only, fsync off, and prints a URL whose role may CREATE DATABASE
# (the harness clones a migrated template into one database per test file).
# A cluster from an earlier call is adopted, not recreated. Exit 1, with the
# reason on stderr, when neither the URL nor initdb is available.
#
# Postgres refuses to run as root, which is what an agent sandbox or a CI
# container often is. As root, the cluster lives under /tmp (a private TMPDIR
# is not traversable by another user), owned by and run as the `postgres` OS
# user when one exists, else `nobody`.
set -euo pipefail

PORT="${TEST_DB_PORT:-54329}"
DIR="${TMPDIR:-/tmp}/$(basename "$(pwd)")-test-db"
URL="postgresql://postgres@127.0.0.1:${PORT}/postgres"

OWNER=""
if [ "$(id -u)" = 0 ]; then
  DIR="/tmp/$(basename "$(pwd)")-test-db"
  if id -u postgres >/dev/null 2>&1; then OWNER=postgres; else OWNER=nobody; fi
fi

# Run a Postgres binary as the cluster's owner (a no-op when not root).
as_owner() {
  if [ -z "$OWNER" ]; then "$@"
  elif command -v runuser >/dev/null 2>&1; then runuser -u "$OWNER" -- "$@"
  else su -s /bin/sh "$OWNER" -c 'exec "$@"' -- "$@"
  fi
}

find_bin() {
  # PATH first, then the places distributions install Postgres without
  # exposing initdb (Debian and Ubuntu keep it under /usr/lib/postgresql).
  local candidate
  if command -v "$1" >/dev/null 2>&1; then command -v "$1"; return 0; fi
  for candidate in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql@*/bin /usr/local/opt/postgresql@*/bin; do
    if [ -x "$candidate/$1" ]; then echo "$candidate/$1"; return 0; fi
  done
  if command -v pg_config >/dev/null 2>&1 && [ -x "$(pg_config --bindir)/$1" ]; then
    echo "$(pg_config --bindir)/$1"; return 0
  fi
  return 1
}

if [ "${1:-}" = stop ]; then
  if [ -d "$DIR" ]; then
    PG_CTL=$(find_bin pg_ctl) || { echo "test-db: pg_ctl not found" >&2; exit 1; }
    as_owner "$PG_CTL" -D "$DIR" -m fast stop >/dev/null 2>&1 || true
    rm -rf "$DIR"
  fi
  exit 0
fi

if [ -n "${TEST_DATABASE_URL:-}" ]; then
  echo "$TEST_DATABASE_URL"
  exit 0
fi

INITDB=$(find_bin initdb) || {
  echo "test-db: initdb not found and TEST_DATABASE_URL is unset." >&2
  echo "Install Postgres 16, start Docker (Testcontainers), or point TEST_DATABASE_URL at a Postgres 16 whose role may CREATE DATABASE." >&2
  exit 1
}
PG_CTL="$(dirname "$INITDB")/pg_ctl"
PG_ISREADY="$(dirname "$INITDB")/pg_isready"

if [ -x "$PG_ISREADY" ] && "$PG_ISREADY" -h 127.0.0.1 -p "$PORT" -q 2>/dev/null; then
  echo "$URL"
  exit 0
fi

if [ ! -f "$DIR/PG_VERSION" ]; then
  rm -rf "$DIR"
  mkdir -p "$DIR"
  if [ -n "$OWNER" ]; then chown "$OWNER" "$DIR"; fi
  as_owner "$INITDB" -D "$DIR" -U postgres -A trust --no-sync -E UTF8 >"$DIR.initdb.log" 2>&1 || {
    echo "test-db: initdb failed; see $DIR.initdb.log" >&2
    exit 1
  }
fi

as_owner "$PG_CTL" -D "$DIR" -l "$DIR/server.log" -w -t 60 \
  -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1 -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
  start >/dev/null 2>&1 || {
  echo "test-db: could not start the cluster on port $PORT; see $DIR/server.log" >&2
  exit 1
}

echo "$URL"
