#!/usr/bin/env bash
set -euo pipefail
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
# Non-interactive shells do not normally load nvm.
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" != 24 ]; then
  if [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh"
    nvm use 24 >/dev/null 2>&1 || { nvm install 24; nvm use 24; }
  else
    echo 'OpenSlate needs Node 24. Install Node 24 or nvm, then run this script again.' >&2
    exit 1
  fi
fi
exec node scripts/start-local.mjs "$@"
