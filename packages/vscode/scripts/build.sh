#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VSCODE_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$VSCODE_DIR")")"
CLIENT_DIR="$ROOT_DIR/packages/client"

echo "=== Building Prokopai client for VSCode (embedded mode) ==="

# Build client with relative base path for webview file:// loading
# VITE_VSCODE_BUILD disables code-splitting so the bundle is one self-contained file.
# vscode-resource:// URLs can't resolve ES module dynamic imports from chunks.
cd "$CLIENT_DIR"
VITE_BASE='./' VITE_VSCODE_BUILD=true bun run build

# Copy client dist into extension
echo ""
echo "=== Copying client dist to extension ==="
rm -rf "$VSCODE_DIR/client-dist"
cp -r "$CLIENT_DIR/dist" "$VSCODE_DIR/client-dist"
echo "Client dist copied to packages/vscode/client-dist/"

# Build the extension TypeScript
echo ""
echo "=== Building extension ==="
cd "$VSCODE_DIR"
bun run build

# Copy VERSION into dist/ so version.ts can read it at runtime
cp "$VSCODE_DIR/VERSION" "$VSCODE_DIR/dist/VERSION"

echo ""
echo "=== Done ==="
echo "Extension built. To package:"
echo "  cd packages/vscode && bun run package"
