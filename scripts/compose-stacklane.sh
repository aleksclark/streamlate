#!/usr/bin/env bash
# Streamlate Stacklane compose lifecycle.
# Always uses: docker compose -p "streamlate-<instance>" -f "$ROOT/docker-compose.stacklane.yml"
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHECK_SCRIPT="${ROOT}/scripts/compose-stacklane-check.sh"
PROJECT_SLUG="streamlate"
COMPOSE_STACKLANE_FILE="${ROOT}/docker-compose.stacklane.yml"

die() { echo "error: $*" >&2; exit 1; }
info() { echo "streamlate-compose: $*" >&2; }

# Neutralize accidental ambient Compose controls, then pin this repo's file.
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME || true

# sanitize_instance: lowercase, non [a-z0-9-] → -, collapse dashes, trim, max 48, fallback dev
sanitize_instance() {
  local s="${1:-}"
  s="$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')"
  s="$(printf '%s' "$s" | sed -E 's/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+//; s/-+$//')"
  if [[ ${#s} -gt 48 ]]; then
    s="${s:0:48}"
    s="$(printf '%s' "$s" | sed -E 's/-+$//')"
  fi
  if [[ -z "$s" ]]; then
    s="dev"
  fi
  printf '%s' "$s"
}

derive_instance() {
  if [[ -n "${STACKLANE_INSTANCE:-}" ]]; then
    sanitize_instance "$STACKLANE_INSTANCE"
    return
  fi
  local wt
  wt="$(basename "$ROOT")"
  if [[ -n "$wt" && "$wt" != "." && "$wt" != "/" ]]; then
    sanitize_instance "$wt"
    return
  fi
  local branch=""
  if command -v git >/dev/null 2>&1; then
    branch="$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  fi
  if [[ -n "$branch" && "$branch" != "HEAD" ]]; then
    sanitize_instance "$branch"
    return
  fi
  sanitize_instance "dev"
}

detect_base_domain() {
  if [[ -n "${STACKLANE_BASE_DOMAIN:-}" ]]; then
    printf '%s' "$STACKLANE_BASE_DOMAIN"
    return
  fi
  if ! command -v stacklane >/dev/null 2>&1; then
    printf 'test'
    return
  fi
  local detected=""
  detected="$(
    timeout 3 stacklane status -o json 2>/dev/null \
      | python3 -c 'import json,sys,re
try:
    raw=json.load(sys.stdin)
except Exception:
    sys.exit(0)
val=raw.get("base_domain") if isinstance(raw, dict) else None
if isinstance(val, str) and re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?", val):
    print(val)
' 2>/dev/null || true
  )"
  if [[ -n "$detected" ]]; then
    printf '%s' "$detected"
    return
  fi
  printf 'test'
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker not found"
  docker compose version >/dev/null 2>&1 || die "docker compose not available"
  [[ -f "$COMPOSE_STACKLANE_FILE" ]] || die "missing $COMPOSE_STACKLANE_FILE"
}

compose() {
  docker compose -p "$COMPOSE_PROJECT" --project-directory "$ROOT" -f "$COMPOSE_STACKLANE_FILE" "$@"
}

export_stack_env() {
  INSTANCE="$(derive_instance)"
  COMPOSE_PROJECT="${PROJECT_SLUG}-${INSTANCE}"
  export STACKLANE_INSTANCE="$INSTANCE"
  export COMPOSE_PROJECT_NAME="$COMPOSE_PROJECT"
  local base_domain
  base_domain="$(detect_base_domain)"
  export STACKLANE_BASE_DOMAIN="$base_domain"
}

host_port_for() {
  local svc="$1"
  local target="$2"
  local mapping
  mapping="$(compose port "$svc" "$target" 2>/dev/null || true)"
  if [[ -z "$mapping" ]]; then
    printf ''
    return
  fi
  printf '%s' "${mapping##*:}"
}

stacklane_status_line() {
  if ! command -v stacklane >/dev/null 2>&1; then
    printf 'stacklane: BLOCKED (daemon/cli absent — direct loopback ports still work)\n'
    return
  fi
  if timeout 3 stacklane status >/dev/null 2>&1; then
    local api_fqdn="api.${INSTANCE}.${PROJECT_SLUG}.${STACKLANE_BASE_DOMAIN:-test}"
    if timeout 3 stacklane resolve "$api_fqdn" >/dev/null 2>&1; then
      printf 'stacklane: OK\n'
    else
      printf 'stacklane: degraded (daemon up; %s not resolved yet)\n' "$api_fqdn"
    fi
  else
    printf 'stacklane: BLOCKED (daemon not reachable)\n'
  fi
}

print_endpoints() {
  local api_hp translation_hp listener_hp base
  api_hp="$(host_port_for server 8080)"
  translation_hp="$(host_port_for translation-client 80)"
  listener_hp="$(host_port_for listener-client 80)"
  base="${STACKLANE_BASE_DOMAIN:-test}"

  echo "api.${INSTANCE}.${PROJECT_SLUG}.${base}:8080"
  echo "translation.${INSTANCE}.${PROJECT_SLUG}.${base}:3001"
  echo "listener.${INSTANCE}.${PROJECT_SLUG}.${base}:3002"
  echo "webrtc media UDP 50000-50100 stays on the host (not proxied by Stacklane)"
  if [[ -n "$api_hp" ]]; then
    echo "direct api:          http://127.0.0.1:${api_hp}/"
  else
    echo "direct api:          (not published — stack down?)"
  fi
  if [[ -n "$translation_hp" ]]; then
    echo "direct translation:  http://127.0.0.1:${translation_hp}/"
  else
    echo "direct translation:  (not published — stack down?)"
  fi
  if [[ -n "$listener_hp" ]]; then
    echo "direct listener:     http://127.0.0.1:${listener_hp}/"
  else
    echo "direct listener:     (not published — stack down?)"
  fi
  stacklane_status_line
  echo "instance: ${INSTANCE}"
  echo "compose project: ${COMPOSE_PROJECT}"
  echo "stacklane base_domain: ${base}"
}

wait_healthy() {
  local timeout_s="${1:-300}"
  local start now elapsed
  start="$(date +%s)"
  info "waiting for server+clients healthy (timeout ${timeout_s}s)…"
  while true; do
    now="$(date +%s)"
    elapsed=$((now - start))
    if (( elapsed > timeout_s )); then
      compose ps || true
      die "services not healthy within ${timeout_s}s"
    fi
    local server_h translation_h listener_h
    server_h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${COMPOSE_PROJECT}-server-1" 2>/dev/null || echo missing)"
    translation_h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${COMPOSE_PROJECT}-translation-client-1" 2>/dev/null || echo missing)"
    listener_h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "${COMPOSE_PROJECT}-listener-client-1" 2>/dev/null || echo missing)"
    if [[ "$server_h" == "healthy" && "$translation_h" == "healthy" && "$listener_h" == "healthy" ]]; then
      info "server, translation-client, and listener-client healthy"
      return 0
    fi
    sleep 2
  done
}

cmd_check() {
  require_docker
  export_stack_env
  bash "$CHECK_SCRIPT"
}

cmd_up() {
  require_docker
  export_stack_env
  bash "$CHECK_SCRIPT"
  info "building images (project=${COMPOSE_PROJECT} instance=${INSTANCE})…"
  compose build
  info "starting stack…"
  compose up -d --remove-orphans
  wait_healthy 360
  print_endpoints
}

cmd_status() {
  require_docker
  export_stack_env
  compose ps
  echo
  print_endpoints
}

cmd_logs() {
  require_docker
  export_stack_env
  if [[ $# -eq 0 ]]; then
    info "following logs (Ctrl-C leaves stack up; run: bash scripts/compose-stacklane.sh down)"
    compose logs -f
  else
    compose logs "$@"
  fi
}

cmd_down() {
  require_docker
  export_stack_env
  info "stopping stack (volumes preserved; never uses -v)…"
  compose down --remove-orphans
}

cmd_destroy() {
  require_docker
  export_stack_env
  local expect="${COMPOSE_PROJECT}-destroy"
  if [[ "${CONFIRM:-}" != "$expect" ]]; then
    die "refusing destroy: set CONFIRM=${expect} to remove volumes for project ${COMPOSE_PROJECT}"
  fi
  info "destroying stack AND volumes for ${COMPOSE_PROJECT}…"
  compose down -v --remove-orphans
}

cmd_endpoints() {
  require_docker
  export_stack_env
  print_endpoints
}

usage() {
  cat <<'EOF'
Usage: scripts/compose-stacklane.sh <command>

Commands:
  check       Fail-closed Stacklane/compose contract validation
  up          check + build + up -d + wait healthy + print endpoints
  status      compose ps + endpoint table
  logs        docker compose logs (default -f; Ctrl-C leaves stack running)
  down        compose down (never -v; volumes preserved)
  destroy     compose down -v (requires CONFIRM=<compose-project>-destroy)
  endpoints   print FQDNs + direct loopback mappings

Environment:
  STACKLANE_INSTANCE     override instance slug (else worktree dirname / branch)
  STACKLANE_BASE_DOMAIN  FQDN base (default: host daemon base_domain, else test)

Notes:
  - Host cargo/npm Vite path and e2e/docker-compose.yml are unchanged.
  - Host-dev loopback-audio stack remains: docker compose -f docker-compose.yml
  - UDP 50000-50100 is WebRTC media and is not proxied by Stacklane.
  - Stacklane daemon is optional; direct 127.0.0.1 ephemeral HTTP ports always work.
  - destroy requires exact CONFIRM=$COMPOSE_PROJECT-destroy (never an alias).
EOF
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    check) cmd_check "$@" ;;
    up) cmd_up "$@" ;;
    status) cmd_status "$@" ;;
    logs) cmd_logs "$@" ;;
    down) cmd_down "$@" ;;
    destroy) cmd_destroy "$@" ;;
    endpoints) cmd_endpoints "$@" ;;
    -h|--help|help|"") usage; [[ -n "$cmd" ]] || exit 1 ;;
    *) die "unknown command: $cmd (try --help)" ;;
  esac
}

main "$@"
