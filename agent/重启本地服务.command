#!/bin/zsh
set -e
cd "$(dirname "$0")"
agent_pid=$(/usr/sbin/lsof -t -iTCP:17851 -sTCP:LISTEN 2>/dev/null || true)
if [[ -n "$agent_pid" ]]; then
  if [[ "$agent_pid" == *$'\n'* ]]; then echo '端口有多个进程，未停止任何程序。'; exit 1; fi
  agent_cwd=$(/usr/sbin/lsof -a -p "$agent_pid" -d cwd -Fn 2>/dev/null | /usr/bin/sed -n 's/^n//p')
  if [[ "$agent_cwd" != "$PWD" ]]; then echo '端口被其他程序占用，未停止该程序。'; exit 1; fi
  kill -TERM "$agent_pid"
  for attempt in {1..50}; do
    if ! /usr/sbin/lsof -t -iTCP:17851 -sTCP:LISTEN >/dev/null 2>&1; then break; fi
    sleep 0.2
  done
  if /usr/sbin/lsof -t -iTCP:17851 -sTCP:LISTEN >/dev/null 2>&1; then echo '旧服务尚未退出，请稍后重试。'; exit 1; fi
fi
exec ./启动本地服务.command
