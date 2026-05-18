#!/usr/bin/env bash
set -euo pipefail

logs_dir="${1:-$(pwd)}"
filter_tokens="${2:-}"
label="${3:-Sandcastle logs}"

if [[ -t 1 ]]; then
  c_reset=$'\033[0m'
  c_title=$'\033[1;36m'
  c_key=$'\033[0;33m'
  c_dim=$'\033[0;90m'
else
  c_reset=""
  c_title=""
  c_key=""
  c_dim=""
fi

mkdir -p "$logs_dir"

current_file=""
tail_pid=""

cleanup() {
  if [[ -n "$tail_pid" ]] && kill -0 "$tail_pid" 2>/dev/null; then
    kill "$tail_pid" 2>/dev/null || true
    wait "$tail_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

render_header() {
  local current_name="${1:-waiting}"
  clear
  printf '%s== %s ==%s\n' "$c_title" "$label" "$c_reset"
  printf '%sfile%s: %s\n' "$c_key" "$c_reset" "$current_name"
  printf '%sdir %s: %s\n' "$c_key" "$c_reset" "$logs_dir"
  printf '%s%s%s\n\n' "$c_dim" '------------------------------------------------------------' "$c_reset"
}

render_header "waiting"

matches_filter() {
  local file_name="$1"
  local token=""

  if [[ -z "$filter_tokens" ]]; then
    return 0
  fi

  IFS=',' read -r -a tokens <<< "$filter_tokens"
  for token in "${tokens[@]}"; do
    [[ -n "$token" ]] || continue
    if [[ "$file_name" == *"$token"* ]]; then
      return 0
    fi
  done

  return 1
}

latest_log_file() {
  local candidate=""
  local candidate_mtime=""
  local file=""
  local mtime=""
  local base_name=""

  shopt -s nullglob
  for file in "$logs_dir"/*.log; do
    [[ -f "$file" ]] || continue
    base_name="$(basename "$file")"
    matches_filter "$base_name" || continue
    mtime="$(stat -c '%Y' "$file" 2>/dev/null || true)"
    [[ -n "$mtime" ]] || continue
    if [[ -z "$candidate_mtime" || "$mtime" -gt "$candidate_mtime" ]]; then
      candidate="$file"
      candidate_mtime="$mtime"
    fi
  done
  shopt -u nullglob

  printf '%s\n' "$candidate"
}

while true; do
  latest_file="$(latest_log_file)"

  if [[ -n "$latest_file" && "$latest_file" != "$current_file" ]]; then
    cleanup
    current_file="$latest_file"
    render_header "$(basename "$current_file")"
    tail -n 40 -F "$current_file" &
    tail_pid="$!"
  fi

  sleep 1
done
