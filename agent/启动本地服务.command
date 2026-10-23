#!/bin/zsh
set -e
cd "$(dirname "$0")"
if [[ -x runtime/node ]]; then
  node_bin="$PWD/runtime/node"
else
  if ! command -v node >/dev/null 2>&1 && [[ -f "$HOME/.nvm/nvm.sh" ]]; then source "$HOME/.nvm/nvm.sh"; fi
  node_bin="$(command -v node || true)"
fi
if [[ -z "$node_bin" ]]; then
  echo "请先安装 Node.js 24 或以上，再运行此文件。"; exit 1
fi
if ! "$node_bin" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)'; then
  echo "需要 Node.js 24 或以上，当前版本过低。"; exit 1
fi
exec "$node_bin" server.mjs
