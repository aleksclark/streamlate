#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Build and optionally deploy the Streamlate server."
    echo ""
    echo "Options:"
    echo "  --build-only     Build artifacts without deploying"
    echo "  --target HOST    Deploy target (user@host), required for deploy"
    echo "  --install-dir    Remote install directory (default: /opt/streamlate)"
    echo "  -h, --help       Show this help message"
    echo ""
    echo "Environment variables:"
    echo "  STREAMLATE_TARGET   Default deploy target (overridden by --target)"
}

BUILD_ONLY=false
TARGET="${STREAMLATE_TARGET:-}"
INSTALL_DIR="/opt/streamlate"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --build-only)   BUILD_ONLY=true; shift ;;
        --target)       TARGET="$2"; shift 2 ;;
        --install-dir)  INSTALL_DIR="$2"; shift 2 ;;
        -h|--help)      usage; exit 0 ;;
        *)              echo "Unknown option: $1"; usage; exit 1 ;;
    esac
done

echo "=== Building Streamlate Server ==="

echo "Building server binary (release)..."
cd "$PROJECT_ROOT"
cargo build --release -p streamlate-server

echo "Building translation client..."
if [ -d "$PROJECT_ROOT/clients/translation" ]; then
    cd "$PROJECT_ROOT/clients/translation"
    npm ci --silent 2>/dev/null || npm install --silent
    npm run build
fi

echo "Building listener client..."
if [ -d "$PROJECT_ROOT/clients/listener" ]; then
    cd "$PROJECT_ROOT/clients/listener"
    npm ci --silent 2>/dev/null || npm install --silent
    npm run build
fi

ARTIFACTS_DIR="$PROJECT_ROOT/dist"
mkdir -p "$ARTIFACTS_DIR"

cp "$PROJECT_ROOT/target/release/streamlate-server" "$ARTIFACTS_DIR/"

if [ -d "$PROJECT_ROOT/clients/translation/dist" ]; then
    mkdir -p "$ARTIFACTS_DIR/www/translation"
    cp -r "$PROJECT_ROOT/clients/translation/dist/"* "$ARTIFACTS_DIR/www/translation/"
fi

if [ -d "$PROJECT_ROOT/clients/listener/dist" ]; then
    mkdir -p "$ARTIFACTS_DIR/www/listener"
    cp -r "$PROJECT_ROOT/clients/listener/dist/"* "$ARTIFACTS_DIR/www/listener/"
fi

cp "$PROJECT_ROOT/deploy/streamlate-server.service" "$ARTIFACTS_DIR/" 2>/dev/null || true
cp "$PROJECT_ROOT/deploy/Caddyfile" "$ARTIFACTS_DIR/" 2>/dev/null || true
cp "$PROJECT_ROOT/deploy/streamlate-server.toml" "$ARTIFACTS_DIR/" 2>/dev/null || true

echo "Build artifacts written to: $ARTIFACTS_DIR"

if [ "$BUILD_ONLY" = true ]; then
    echo "Build complete (--build-only mode)."
    exit 0
fi

if [ -z "$TARGET" ]; then
    echo ""
    echo "No deploy target specified. Use --target user@host or set STREAMLATE_TARGET."
    echo "Run with --build-only to skip deployment."
    exit 0
fi

echo ""
echo "=== Deploying to $TARGET ==="

ssh "$TARGET" "sudo mkdir -p $INSTALL_DIR/{bin,www,data,config}"

echo "Uploading server binary..."
scp "$ARTIFACTS_DIR/streamlate-server" "$TARGET:/tmp/streamlate-server"
ssh "$TARGET" "sudo mv /tmp/streamlate-server $INSTALL_DIR/bin/ && sudo chmod +x $INSTALL_DIR/bin/streamlate-server"

if [ -d "$ARTIFACTS_DIR/www/translation" ]; then
    echo "Uploading translation client..."
    scp -r "$ARTIFACTS_DIR/www/translation" "$TARGET:/tmp/streamlate-translation"
    ssh "$TARGET" "sudo rm -rf $INSTALL_DIR/www/translation && sudo mv /tmp/streamlate-translation $INSTALL_DIR/www/translation"
fi

if [ -d "$ARTIFACTS_DIR/www/listener" ]; then
    echo "Uploading listener client..."
    scp -r "$ARTIFACTS_DIR/www/listener" "$TARGET:/tmp/streamlate-listener"
    ssh "$TARGET" "sudo rm -rf $INSTALL_DIR/www/listener && sudo mv /tmp/streamlate-listener $INSTALL_DIR/www/listener"
fi

if [ -f "$ARTIFACTS_DIR/streamlate-server.service" ]; then
    echo "Installing systemd service..."
    scp "$ARTIFACTS_DIR/streamlate-server.service" "$TARGET:/tmp/streamlate-server.service"
    ssh "$TARGET" "sudo mv /tmp/streamlate-server.service /etc/systemd/system/ && sudo systemctl daemon-reload"
fi

echo "Restarting service..."
ssh "$TARGET" "sudo systemctl restart streamlate-server"

echo ""
echo "=== Deployment complete ==="
echo "Check status: ssh $TARGET 'sudo systemctl status streamlate-server'"
