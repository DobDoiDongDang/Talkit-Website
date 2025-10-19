#!/usr/bin/env bash
# start-docker-compose.sh
# Safe script to start the docker-compose stack in this folder.
# It will cd to the script's directory, detect whether 'docker compose' or
# 'docker-compose' is available, and run it with passed arguments.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default compose file name (use docker-compose.yml from this folder)
COMPOSE_FILE="docker-compose.yml"

# Allow overriding COMPOSE_FILE via env or first positional arg --file
# but keep simple: user can pass -f/--file args directly.

# Check for docker
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not in PATH. Please install Docker." >&2
  exit 2
fi

# Prefer 'docker compose' (v2+), fallback to 'docker-compose'
DOCKER_COMPOSE_CMD=""
if docker compose version >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DOCKER_COMPOSE_CMD=(docker-compose)
else
  echo "Neither 'docker compose' nor 'docker-compose' command available." >&2
  echo "Install Docker Compose (included in Docker Desktop or as separate binary)." >&2
  exit 3
fi

# If no args passed, default to 'up -d --build'
if [ "$#" -eq 0 ]; then
  echo "No args provided. Running: ${DOCKER_COMPOSE_CMD[*]} up -d --build"
  "${DOCKER_COMPOSE_CMD[@]}" up -d --build
else
  echo "Running: ${DOCKER_COMPOSE_CMD[*]} $@"
  "${DOCKER_COMPOSE_CMD[@]}" "$@"
fi

echo "Done."