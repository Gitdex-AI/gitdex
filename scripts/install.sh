#!/usr/bin/env bash
set -euo pipefail

repo_url="${GITDEX_REPO_URL:-https://github.com/Gitdex-AI/gitdex.git}"
ref="${GITDEX_REF:-v0.2.0}"
install_dir="${GITDEX_INSTALL_DIR:-$HOME/.gitdex/app}"
bin_dir="${GITDEX_BIN_DIR:-$HOME/.local/bin}"
build="${GITDEX_SKIP_BUILD:-0}"
install_service="${GITDEX_INSTALL_SERVICE:-0}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need git
need node
need npm

mkdir -p "$bin_dir"

if [ -d "$install_dir/.git" ]; then
  echo "Updating Gitdex in $install_dir at $ref"
  git -C "$install_dir" fetch --tags origin
  git -C "$install_dir" checkout "$ref"
  if git -C "$install_dir" symbolic-ref -q HEAD >/dev/null 2>&1; then
    git -C "$install_dir" pull --ff-only
  fi
else
  echo "Installing Gitdex $ref into $install_dir"
  mkdir -p "$(dirname "$install_dir")"
  git clone --branch "$ref" "$repo_url" "$install_dir"
fi

cd "$install_dir"
npm install

if [ "$build" != "1" ]; then
  npm run build
fi

chmod +x "$install_dir/bin/gitdex.mjs"
ln -sf "$install_dir/bin/gitdex.mjs" "$bin_dir/gitdex"

echo
echo "Gitdex installed."
echo "Command: $bin_dir/gitdex"
echo "Run: gitdex doctor"
echo "Start dev server: gitdex dev"
echo "Open: http://127.0.0.1:8000"

if [ "$install_service" = "1" ]; then
  "$bin_dir/gitdex" install-service --no-build
  echo "Service installed. Check it with: gitdex service-status"
else
  echo "Install as a background service: $bin_dir/gitdex install-service"
fi

case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *)
    echo
    echo "Add this directory to PATH if needed:"
    echo "  export PATH=\"$bin_dir:\$PATH\""
    ;;
esac
