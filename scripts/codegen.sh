#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "==> Generating OpenAPI spec from server..."
cargo run -p streamlate-server -- --export-openapi > "$ROOT_DIR/openapi.json"

echo "==> Generating TypeScript client..."
mkdir -p "$ROOT_DIR/clients/shared/src/api/generated"
cd "$ROOT_DIR/e2e"
npx openapi-typescript-codegen \
  --input "$ROOT_DIR/openapi.json" \
  --output "$ROOT_DIR/clients/shared/src/api/generated" \
  --client fetch

echo "==> Done. Generated client at clients/shared/src/api/generated/"
