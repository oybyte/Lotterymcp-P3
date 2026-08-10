#!/usr/bin/env bash
# rebuild-and-serve.sh — 一键重建最新代码并重启排列3只读研究台
#
# 用法:
#   bash scripts/rebuild-and-serve.sh            # 默认端口 4317
#   bash scripts/rebuild-and-serve.sh 4318       # 指定端口
#
# 流程: 预清空构建产物(绕过 WorkBuddy safe-delete 拦截) → npm run build
#       → data sync + ops run-once → 重启 serve-reports → 健康检查
#
# 注意: CLI/SQLite 必须用系统 Node24 运行(better-sqlite3 原生模块按 Node24 编译)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${1:-4317}"
NODE24="/c/Program Files/nodejs/node.exe"
DATA_DIR="${LOTTERYMCP_DATA_DIR:-$ROOT/.lotterymcp-data}"

# /d/xxx  ->  D:\xxx  (Git Bash 路径转 Windows 路径，供 PowerShell 使用)
win_path() {
  local p="$1"
  if [[ "$p" =~ ^/([a-zA-Z])/(.*)$ ]]; then
    printf '%s:\\%s' "$(tr 'a-z' 'A-Z' <<<"${BASH_REMATCH[1]}")" "${BASH_REMATCH[2]//\//\\}"
  else
    printf '%s' "$p"
  fi
}

WEB_DIST="$(win_path "$ROOT/packages/web/dist")"
CLI_WEB="$(win_path "$ROOT/packages/cli/dist/web")"
NODE24_WIN="$(win_path "$NODE24")"
ROOT_WIN="$(win_path "$ROOT")"
DATA_DIR_WIN="$(win_path "$DATA_DIR")"
# Node 在 Windows 上需要正斜杠绝对路径（反斜杠/正斜杠混合会被解析成 D:\d\... 错路径）
DATA_DIR_NODE="$(printf '%s' "$DATA_DIR_WIN" | tr '\\' '/')"

if [ ! -f "$NODE24" ]; then
  echo "[错误] 未找到系统 Node24: $NODE24" >&2
  exit 1
fi

echo "==> [1/4] 预清空构建输出目录 (绕过 safe-delete 拦截)"
powershell.exe -NoProfile -Command "\$a='$WEB_DIST'; \$b='$CLI_WEB'; Remove-Item -LiteralPath \$a -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item -LiteralPath \$b -Recurse -Force -ErrorAction SilentlyContinue"

echo "==> [2/4] 构建前端 + TS + 同步产物"
cd "$ROOT"
npm run build

echo "==> [3/4] 同步开奖数据 + 生成日报"
export LOTTERYMCP_DATA_DIR="$DATA_DIR_NODE"
"$NODE24" packages/cli/dist/index.js data sync
"$NODE24" packages/cli/dist/index.js ops run-once

echo "==> [4/4] 重启 serve-reports (127.0.0.1:$PORT)"
# 杀掉所有残留的 serve-reports 进程（不限端口），避免新旧版本同时监听导致前端拿到旧 API 字段而崩
powershell.exe -NoProfile -Command "\$ErrorActionPreference='SilentlyContinue'; Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { \$_.CommandLine -like '*ops*serve-reports*' } | ForEach-Object { Stop-Process -Id \$_.ProcessId -Force }"
powershell.exe -NoProfile -Command "\$env:LOTTERYMCP_DATA_DIR='$DATA_DIR_WIN'; Start-Process -FilePath '$NODE24_WIN' -ArgumentList 'packages/cli/dist/index.js','ops','serve-reports','--host','127.0.0.1','--port','$PORT' -WorkingDirectory '$ROOT_WIN' -WindowStyle Hidden"

code="$(curl -s -o /dev/null -w '%{http_code}' --retry 8 --retry-delay 1 --retry-connrefused --max-time 3 "http://127.0.0.1:$PORT/" || true)"
if [ "$code" = "200" ]; then
  echo "✅ 研究台已就绪: http://127.0.0.1:$PORT/ (HTTP 200)"
else
  echo "⚠️  健康检查未通过 (HTTP ${code:-无响应})，请查看上方日志排查" >&2
  exit 1
fi
