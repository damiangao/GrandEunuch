#!/usr/bin/env bash
# Manages the local GrandEunuch server as a background process.
# Production mode by default (fast start, no recompiles); pass --dev for hot reload.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-3000}"
RUN_DIR=".run"
PID_FILE="$RUN_DIR/server.pid"
LOG_FILE="$RUN_DIR/server.log"
MODE_FILE="$RUN_DIR/mode"

# The listening process is the truth, not the recorded PID: setsid exits
# immediately, so $! is the detacher rather than the server itself.
running_pid() {
  local pid
  pid=$(lsof -ti ":$PORT" -sTCP:LISTEN 2>/dev/null | head -1)
  [ -n "$pid" ] || return 1
  echo "$pid"
}

start() {
  local mode="production"
  [ "${1:-}" = "--dev" ] && mode="development"

  if pid=$(running_pid); then
    echo "已在运行 (pid $pid, $(cat "$MODE_FILE" 2>/dev/null || echo unknown))。要重启用: $0 restart"
    return 0
  fi

  if [ ! -f .env ]; then
    echo "缺少 .env — 复制 .env.example 并填入 LLM 配置。" >&2
    return 1
  fi

  mkdir -p "$RUN_DIR"

  if [ "$mode" = "production" ]; then
    echo "构建中…"
    npm run build > "$RUN_DIR/build.log" 2>&1 || {
      echo "构建失败，详见 $RUN_DIR/build.log" >&2
      return 1
    }
    # nohup + disown keeps the server alive after this terminal closes.
    # (macOS has no setsid.)
    nohup npx next start --hostname 127.0.0.1 --port "$PORT" >> "$LOG_FILE" 2>&1 &
  else
    nohup npx next dev --hostname 127.0.0.1 --port "$PORT" >> "$LOG_FILE" 2>&1 &
  fi
  disown 2>/dev/null || true

  echo $! > "$PID_FILE"
  echo "$mode" > "$MODE_FILE"

  # Readiness is what matters, not the spawn — poll the API instead of sleeping.
  for _ in $(seq 1 40); do
    if curl -sf "http://127.0.0.1:$PORT/api/conversations/default" -o /dev/null 2>/dev/null; then
      echo "已启动 ($mode, pid $(cat "$PID_FILE")) → http://127.0.0.1:$PORT"
      return 0
    fi
    sleep 0.5
  done

  echo "启动超时，最后的日志：" >&2
  tail -20 "$LOG_FILE" >&2
  return 1
}

stop() {
  if ! pid=$(running_pid); then
    echo "没有在运行。"
    rm -f "$PID_FILE" "$MODE_FILE"
    return 0
  fi

  # Signal the whole process group so Next's child workers go down too. The
  # group id comes from the listening process, not from the recorded PID.
  local pgid
  pgid=$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')

  if [ -n "$pgid" ]; then
    kill -TERM "-$pgid" 2>/dev/null || true
  else
    kill -TERM "$pid" 2>/dev/null || true
  fi

  for _ in $(seq 1 20); do
    running_pid > /dev/null || break
    sleep 0.5
  done

  if running_pid > /dev/null; then
    if [ -n "$pgid" ]; then
      kill -KILL "-$pgid" 2>/dev/null || true
    else
      kill -KILL "$pid" 2>/dev/null || true
    fi
  fi

  rm -f "$PID_FILE" "$MODE_FILE"
  echo "已停止。"
}

case "${1:-}" in
  start)   shift; start "$@" ;;
  stop)    stop ;;
  restart) stop; shift; start "$@" ;;
  status)
    if pid=$(running_pid); then
      echo "运行中 (pid $pid, $(cat "$MODE_FILE" 2>/dev/null || echo unknown)) → http://127.0.0.1:$PORT"
    else
      echo "未运行。"
    fi
    ;;
  logs)    tail -f "$LOG_FILE" ;;
  *)
    cat <<EOF
用法: $0 {start|stop|restart|status|logs} [--dev]

  start          构建并后台启动（生产模式）
  start --dev    后台启动开发模式（热重载，不构建）
  stop           停止
  restart        重启，可加 --dev
  status         查看是否在运行
  logs           跟踪日志 (Ctrl-C 退出)

端口默认 3000，可用 PORT=3100 $0 start 覆盖。
EOF
    exit 1
    ;;
esac
