#!/usr/bin/env bash
# Fail-closed validation for streamlate docker-compose.stacklane.yml.
# Uses `docker compose config --format json` into a mode-0700 temp file; never dumps full env/secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_SLUG="streamlate"
COMPOSE_STACKLANE_FILE="${ROOT}/docker-compose.stacklane.yml"

die() { echo "compose-stacklane-check: FAIL: $*" >&2; exit 1; }
ok() { echo "compose-stacklane-check: ok: $*" >&2; }
info() { echo "compose-stacklane-check: $*" >&2; }

# Do not inherit an operator's compose file/profile/project accidentally.
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME || true

sanitize_instance() {
  local s="${1:-}"
  s="$(printf '%s' "$s" | tr '[:upper:]' '[:lower:]')"
  s="$(printf '%s' "$s" | sed -E 's/[^a-z0-9-]+/-/g; s/-+/-/g; s/^-+//; s/-+$//')"
  if [[ ${#s} -gt 48 ]]; then
    s="${s:0:48}"
    s="$(printf '%s' "$s" | sed -E 's/-+$//')"
  fi
  [[ -z "$s" ]] && s="dev"
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

require_tools() {
  command -v docker >/dev/null 2>&1 || die "docker not found"
  docker compose version >/dev/null 2>&1 || die "docker compose not available"
  command -v python3 >/dev/null 2>&1 || die "python3 required for JSON parse"
  [[ -f "$COMPOSE_STACKLANE_FILE" ]] || die "missing $COMPOSE_STACKLANE_FILE"
}

render_config() {
  local project="$1"
  local instance="$2"
  local out="$3"
  local base_dom="${STACKLANE_BASE_DOMAIN:-test}"
  umask 077
  : >"$out"
  chmod 600 "$out"
  if ! STACKLANE_INSTANCE="$instance" \
    STACKLANE_BASE_DOMAIN="$base_dom" \
    COMPOSE_PROJECT_NAME="$project" \
    docker compose -p "$project" --project-directory "$ROOT" -f "$COMPOSE_STACKLANE_FILE" config --format json >"$out" 2>/dev/null; then
    die "compose config render failed (rule: render)"
  fi
  chmod 600 "$out"
}

run_mutation_probes() {
  local tmpdir="$1"
  local base_yml="$COMPOSE_STACKLANE_FILE"
  python3 - "$base_yml" "$tmpdir" "$ROOT" <<'PY'
import json, os, pathlib, subprocess, sys

base_path = pathlib.Path(sys.argv[1])
tmpdir = pathlib.Path(sys.argv[2])
root = pathlib.Path(sys.argv[3])
src = base_path.read_text()

def write_mut(name, text):
    p = tmpdir / f"mut-{name}.yml"
    p.write_text(text)
    return p

mutations = [
    ("wildcard-host", src.replace('"127.0.0.1::8080"', '"0.0.0.0::8080"'), "host_ip must be 127.0.0.1"),
    ("fixed-host-port", src.replace('"127.0.0.1::8080"', '"127.0.0.1:18080:8080"'), "published port must be ephemeral"),
    ("missing-enable-label", src.replace('\n      stacklane.enable: "true"\n', '\n', 1), "stacklane.enable"),
]

failures = 0
for name, text, expect_hint in mutations:
    mut_path = write_mut(name, text)
    out = tmpdir / f"mut-{name}.json"
    env = os.environ.copy()
    env.pop("COMPOSE_FILE", None)
    env.pop("COMPOSE_PROFILES", None)
    env["STACKLANE_INSTANCE"] = "mutprobe"
    env["STACKLANE_BASE_DOMAIN"] = "test"
    env["COMPOSE_PROJECT_NAME"] = "streamlate-mutprobe"
    try:
        with out.open("w") as fh:
            subprocess.run(
                ["docker", "compose", "-p", "streamlate-mutprobe",
                 "--project-directory", str(root), "-f", str(mut_path),
                 "config", "--format", "json"],
                check=True, env=env, stdout=fh, stderr=subprocess.DEVNULL, timeout=60,
            )
    except Exception:
        print(f"mutation {name}: config rejected (ok)", file=sys.stderr)
        continue
    try:
        cfg = json.loads(out.read_text())
    except Exception:
        print(f"mutation {name}: invalid json", file=sys.stderr)
        failures += 1
        continue
    services = cfg.get("services") or {}
    bad = False
    reason = ""
    if name == "wildcard-host":
        for svc, sc in services.items():
            for p in sc.get("ports") or []:
                proto = str(p.get("protocol") or "tcp").lower()
                if proto != "tcp":
                    continue
                hip = p.get("host_ip") or ""
                if hip != "127.0.0.1":
                    bad = True
                    reason = f"{svc} host_ip={hip!r}"
    elif name == "fixed-host-port":
        for svc, sc in services.items():
            for p in sc.get("ports") or []:
                proto = str(p.get("protocol") or "tcp").lower()
                if proto != "tcp":
                    continue
                pub = p.get("published")
                if pub not in (None, "", 0, "0"):
                    bad = True
                    reason = f"{svc} published={pub!r}"
    elif name == "missing-enable-label":
        for svc, sc in services.items():
            labels = sc.get("labels") or {}
            if isinstance(labels, list):
                kv = {}
                for item in labels:
                    if isinstance(item, str) and "=" in item:
                        k, v = item.split("=", 1)
                        kv[k] = v
                labels = kv
            if str(labels.get("stacklane.enable", "")) not in ("true", "1"):
                bad = True
                reason = f"{svc} missing enable"
                break
    if not bad:
        print(f"mutation {name}: FAIL expected defect not detected ({expect_hint})", file=sys.stderr)
        failures += 1
    else:
        print(f"mutation {name}: defect detected ({reason}) ok", file=sys.stderr)

if failures:
    sys.exit(2)
print("mutation probes: all defects detected", file=sys.stderr)
sys.exit(0)
PY
}

validate_rendered() {
  local json_path="$1"
  local expect_instance="$2"
  local expect_project="$3"
  python3 - "$json_path" "$expect_instance" "$expect_project" <<'PY'
import json, sys

path, expect_instance, expect_project = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path, "r", encoding="utf-8") as f:
    cfg = json.load(f)

errors = []

def err(msg):
    errors.append(msg)

services = cfg.get("services") or {}
required = ("server", "translation-client", "listener-client")
for name in required:
    if name not in services:
        err(f"missing service {name}")

name = cfg.get("name") or ""
if name and name != expect_project:
    err(f"compose name {name!r} != expected project {expect_project!r}")

volumes_top = cfg.get("volumes") or {}
vol_keys = set(volumes_top.keys())
for req in ("server-data", "recordings"):
    if req not in vol_keys and not any(req in k for k in vol_keys):
        err(f"missing named volume {req}")

def labels_map(sc):
    labels = sc.get("labels") or {}
    if isinstance(labels, list):
        out = {}
        for item in labels:
            if isinstance(item, str) and "=" in item:
                k, v = item.split("=", 1)
                out[k] = v
        return out
    if isinstance(labels, dict):
        return {str(k): str(v) for k, v in labels.items()}
    return {}

def as_env(raw):
    if isinstance(raw, list):
        out = {}
        for e in raw:
            if isinstance(e, str):
                k, _, v = e.partition("=")
                out[k] = v
        return out
    if isinstance(raw, dict):
        return {str(k): str(v) for k, v in raw.items()}
    return {}

def check_tcp_ports(svc_name, sc, expect_target):
    ports = sc.get("ports") or []
    if not ports:
        err(f"{svc_name}: no published ports")
        return
    tcp = [p for p in ports if isinstance(p, dict) and str(p.get("protocol") or "tcp").lower() == "tcp"]
    if not tcp:
        err(f"{svc_name}: no TCP published ports")
        return
    for p in tcp:
        hip = p.get("host_ip")
        if hip != "127.0.0.1":
            err(f"{svc_name}: TCP host_ip must be 127.0.0.1")
        published = p.get("published")
        if published not in (None, "", 0, "0"):
            err(f"{svc_name}: TCP published must be ephemeral empty/0")
        target = p.get("target")
        if int(target) != int(expect_target):
            err(f"{svc_name}: TCP target port want {expect_target}")

def check_udp_media(sc):
    ports = sc.get("ports") or []
    udp = [p for p in ports if isinstance(p, dict) and str(p.get("protocol") or "").lower() == "udp"]
    if not udp:
        err("server: missing UDP media publish 50000-50100")
        return
    found = False
    for p in udp:
        target = p.get("target")
        published = p.get("published")
        end = p.get("end") or p.get("published_end") or published
        try:
            t = int(target)
            pub = int(published) if published not in (None, "") else t
        except (TypeError, ValueError):
            continue
        if t == 50000 and pub == 50000:
            found = True
    if not found:
        err("server: UDP media range must stay 50000-50100 as-is")

def check_isolation(svc_name, sc):
    if (sc.get("network_mode") or "") == "host":
        err(f"{svc_name}: network_mode=host forbidden")

def has_named(sc, name_part):
    for v in sc.get("volumes") or []:
        if isinstance(v, dict):
            src = str(v.get("source") or "")
            if name_part in src:
                return True
        elif isinstance(v, str) and name_part in v:
            return True
    return False

def check_labels(svc_name, sc, expected):
    labels = labels_map(sc)
    for k, want in expected.items():
        got = str(labels.get(k, ""))
        if got != want:
            err(f"{svc_name} label {k} mismatch")
    enable = str(labels.get("stacklane.enable", ""))
    if enable not in ("true", "1"):
        err(f"{svc_name} stacklane.enable must be true or 1")
    return labels

server = services.get("server") or {}
check_tcp_ports("server", server, 8080)
check_udp_media(server)
check_isolation("server", server)
sl = check_labels("server", server, {
    "stacklane.enable": "true",
    "stacklane.project": "streamlate",
    "stacklane.instance": expect_instance,
    "stacklane.endpoint": "api",
    "stacklane.port": "8080",
})
if sl.get("stacklane.target_port") != "8080":
    err("server stacklane.target_port must be 8080")
if not has_named(server, "server-data"):
    err("server: missing named volume involving server-data")
if not has_named(server, "recordings"):
    err("server: missing named volume involving recordings")

senv = as_env(server.get("environment") or {})
if senv.get("STREAMLATE_BIND") != "0.0.0.0:8080":
    err("server STREAMLATE_BIND must be 0.0.0.0:8080")
if senv.get("STREAMLATE_DB_PATH") != "/data/streamlate.db":
    err("server STREAMLATE_DB_PATH must be /data/streamlate.db")
proxy_like = " ".join(str(v) for v in senv.values())
if "localhost:8080" in proxy_like or "127.0.0.1:8080" in proxy_like:
    err("server env must not hairpin host-published API ports")

hc = server.get("healthcheck") or {}
test = hc.get("test") or []
test_s = test if isinstance(test, str) else " ".join(str(x) for x in test)
if "/api/v1/system/health" not in test_s:
    err("server healthcheck must hit /api/v1/system/health")

translation = services.get("translation-client") or {}
check_tcp_ports("translation-client", translation, 80)
check_isolation("translation-client", translation)
tl = check_labels("translation-client", translation, {
    "stacklane.enable": "true",
    "stacklane.project": "streamlate",
    "stacklane.instance": expect_instance,
    "stacklane.endpoint": "translation",
    "stacklane.port": "3001",
    "stacklane.target_port": "80",
})
thc = translation.get("healthcheck") or {}
ttest = thc.get("test") or []
ttest_s = ttest if isinstance(ttest, str) else " ".join(str(x) for x in ttest)
if "127.0.0.1" not in ttest_s:
    err("translation-client healthcheck must probe loopback")

listener = services.get("listener-client") or {}
check_tcp_ports("listener-client", listener, 80)
check_isolation("listener-client", listener)
ll = check_labels("listener-client", listener, {
    "stacklane.enable": "true",
    "stacklane.project": "streamlate",
    "stacklane.instance": expect_instance,
    "stacklane.endpoint": "listener",
    "stacklane.port": "3002",
    "stacklane.target_port": "80",
})
lhc = listener.get("healthcheck") or {}
ltest = lhc.get("test") or []
ltest_s = ltest if isinstance(ltest, str) else " ".join(str(x) for x in ltest)
if "127.0.0.1" not in ltest_s:
    err("listener-client healthcheck must probe loopback")

for svc_name, sc in (("translation-client", translation), ("listener-client", listener)):
    deps = sc.get("depends_on") or {}
    if isinstance(deps, dict):
        dep = deps.get("server") or {}
        cond = dep.get("condition") if isinstance(dep, dict) else None
        if cond and cond != "service_healthy":
            err(f"{svc_name} depends_on.server.condition want service_healthy")
    elif isinstance(deps, list) and "server" not in deps:
        err(f"{svc_name} depends_on missing server")

blob = json.dumps({
    "server": senv,
    "labels": [sl, tl, ll],
})
if ".local" in blob.lower():
    err("compose-derived config must not use .local domains")

if errors:
    for e in errors:
        print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
print(f"validated instance={expect_instance} project={expect_project}", file=sys.stderr)
sys.exit(0)
PY
}

main() {
  require_tools
  local instance project
  instance="$(derive_instance)"
  project="${PROJECT_SLUG}-${instance}"
  export STACKLANE_INSTANCE="$instance"
  export STACKLANE_BASE_DOMAIN="${STACKLANE_BASE_DOMAIN:-test}"

  umask 077
  COMPOSE_CHECK_TMPDIR="$(mktemp -d "${TMPDIR:-/tmp}/streamlate-compose-check.XXXXXX")"
  chmod 700 "$COMPOSE_CHECK_TMPDIR"
  # shellcheck disable=SC2064
  trap 'rm -rf "${COMPOSE_CHECK_TMPDIR:-}"' EXIT INT TERM

  local cfg1 cfg2
  cfg1="${COMPOSE_CHECK_TMPDIR}/compose-${instance}.json"
  info "rendering compose config for instance=${instance} project=${project}"
  render_config "$project" "$instance" "$cfg1"
  validate_rendered "$cfg1" "$instance" "$project"
  ok "default instance path (${instance})"

  local alt="slc-altcheck"
  local alt_project="${PROJECT_SLUG}-${alt}"
  cfg2="${COMPOSE_CHECK_TMPDIR}/compose-${alt}.json"
  STACKLANE_INSTANCE="$alt" render_config "$alt_project" "$alt" "$cfg2"
  validate_rendered "$cfg2" "$alt" "$alt_project"
  if cmp -s "$cfg1" "$cfg2"; then
    die "two instances produced identical rendered configs"
  fi
  ok "override instance path differs (${alt})"

  info "running mutation probes (fail-closed)"
  run_mutation_probes "$COMPOSE_CHECK_TMPDIR"
  ok "mutation probes"

  ok "all compose-stacklane checks passed"
}

main "$@"
