#!/usr/bin/env bash
# Replace a Backchat.app after its process exits.
# The new bundle is moved into place only after the old one has been kept
# aside. A failure moves that copy back and opens it again.
#
#   apply-mac-update.sh --pid N --app APP --zip ZIP --backup BACKUP --log LOG
#     [--relaunch open|exec|none] [--wait-seconds N]
#
# BACKCHAT_UPDATE_FAIL_AFTER=swap|launch injects a failure for tests.

set -u

pid=""
app=""
zip=""
backup=""
log=""
relaunch=""
wait_seconds="120"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pid) pid="${2:-}"; shift 2 ;;
    --app) app="${2:-}"; shift 2 ;;
    --zip) zip="${2:-}"; shift 2 ;;
    --backup) backup="${2:-}"; shift 2 ;;
    --log) log="${2:-}"; shift 2 ;;
    --relaunch) relaunch="${2:-}"; shift 2 ;;
    --wait-seconds) wait_seconds="${2:-}"; shift 2 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

log_line() {
  local line
  line="$(date -u +%Y-%m-%dT%H:%M:%SZ) $*"
  if [[ -n "$log" ]]; then
    mkdir -p "$(dirname "$log")" 2>/dev/null || true
    printf '%s\n' "$line" >> "$log"
  fi
  printf '%s\n' "$line" >&2
}

if [[ -z "$pid" || -z "$app" || -z "$zip" || -z "$backup" || -z "$log" ]]; then
  printf 'usage: apply-mac-update.sh --pid N --app APP --zip ZIP --backup BACKUP --log LOG\n' >&2
  exit 2
fi

if [[ -z "$relaunch" ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    relaunch="open"
  else
    relaunch="exec"
  fi
fi

case "$relaunch" in
  open|exec|none) ;;
  *) printf 'unknown relaunch: %s\n' "$relaunch" >&2; exit 2 ;;
esac

swapped=0
launched_pid=""
stage=""

clear_quarantine() {
  local target="$1"
  if [[ "$(uname -s)" == "Darwin" && -x /usr/bin/xattr ]]; then
    /usr/bin/xattr -dr com.apple.quarantine "$target" || true
    log_line "quarantine cleared $target"
  fi
}

stop_launched() {
  if [[ -n "$launched_pid" ]]; then
    kill "$launched_pid" 2>/dev/null || true
    launched_pid=""
  fi
}

relaunch_bundle() {
  local target="$1"
  local mode="$2"
  local bin="$target/Contents/MacOS/Backchat"
  case "$mode" in
    none) return 0 ;;
    open)
      if [[ "$(uname -s)" != "Darwin" ]]; then
        log_line "open is only available on macOS"
        return 1
      fi
      /usr/bin/open "$target" || return 1
      local _i
      for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
        if /usr/bin/pgrep -f "$bin" >/dev/null 2>&1; then
          return 0
        fi
        sleep 0.25
      done
      return 1
      ;;
    exec)
      if [[ ! -e "$bin" ]]; then
        return 1
      fi
      chmod +x "$bin" 2>/dev/null || true
      # nohup keeps the relaunched app alive after this helper exits, and $! is that app.
      nohup "$bin" >>"$log" 2>&1 &
      launched_pid=$!
      printf '%s\n' "$launched_pid" > "${log}.pid"
      sleep 0.2
      if ! kill -0 "$launched_pid" 2>/dev/null; then
        launched_pid=""
        return 1
      fi
      return 0
      ;;
  esac
}

rollback() {
  if [[ "$swapped" != 1 ]]; then
    return 0
  fi
  stop_launched
  if [[ -d "$backup" ]]; then
    rm -rf "$app"
    if mv "$backup" "$app"; then
      clear_quarantine "$app"
      log_line "rolled back"
      relaunch_bundle "$app" "$relaunch" || log_line "rollback relaunch failed"
      return 0
    fi
  fi
  log_line "rollback failed"
  return 1
}

cleanup_stage() {
  if [[ -n "$stage" && -d "$stage" ]]; then
    rm -rf "$stage"
  fi
}

die() {
  log_line "$1"
  cleanup_stage
  exit 1
}

abort() {
  log_line "$1"
  rollback || true
  cleanup_stage
  exit 1
}

deadline=$(( $(date +%s) + wait_seconds ))
while kill -0 "$pid" 2>/dev/null; do
  if [[ "$(date +%s)" -ge "$deadline" ]]; then
    die "timed out waiting for pid $pid"
  fi
  sleep 0.2
done

app_name="${app##*/}"
if [[ ! -d "$app" || "$app_name" != *.app ]]; then
  die "app bundle is missing"
fi

if [[ ! -f "$zip" ]]; then
  die "zip is missing"
fi

if ! command -v unzip >/dev/null 2>&1; then
  die "unzip is required"
fi

if ! zip_entries="$(unzip -Z1 "$zip")"; then
  die "cannot list zip"
fi

while IFS= read -r entry; do
  [[ -z "$entry" ]] && continue
  case "$entry" in
    /*) die "zip entry is absolute: $entry" ;;
  esac
  case "/$entry/" in
    */../*) die "zip entry escapes: $entry" ;;
  esac
done <<< "$zip_entries"

stage="$(mktemp -d "${TMPDIR:-/tmp}/backchat-update.XXXXXX")"

if [[ "$(uname -s)" == "Darwin" && -x /usr/bin/ditto ]]; then
  /usr/bin/ditto -x -k "$zip" "$stage" || abort "could not extract zip"
else
  unzip -q "$zip" -d "$stage" || abort "could not extract zip"
fi

found=()
while IFS= read -r line; do
  [[ -n "$line" ]] && found+=("$line")
done < <(find "$stage" -type d -name "Backchat.app")

if [[ "${#found[@]}" -ne 1 ]]; then
  abort "expected one Backchat.app, found ${#found[@]}"
fi
new_app="${found[0]}"
case "$new_app" in
  "$stage"/*) ;;
  *) abort "extracted app is outside the stage" ;;
esac

if [[ ! -e "$new_app/Contents/MacOS/Backchat" ]]; then
  abort "extracted app has no executable"
fi

if [[ "${BACKCHAT_UPDATE_FAIL_AFTER:-}" == "swap" ]]; then
  rm -rf "$backup"
  if ! mv "$app" "$backup"; then
    die "could not move the current app aside"
  fi
  swapped=1
  abort "injected failure after swap"
fi

rm -rf "$backup"
if ! mv "$app" "$backup"; then
  die "could not move the current app aside"
fi
swapped=1

if ! mv "$new_app" "$app"; then
  abort "could not move the new app into place"
fi

chmod +x "$app/Contents/MacOS/Backchat" 2>/dev/null || true
clear_quarantine "$app"

if [[ ! -e "$app/Contents/MacOS/Backchat" ]]; then
  abort "new app is missing its executable"
fi

if [[ "${BACKCHAT_UPDATE_FAIL_AFTER:-}" == "launch" ]]; then
  if ! relaunch_bundle "$app" "$relaunch"; then
    abort "injected launch did not start"
  fi
  abort "injected failure after launch"
fi

if ! relaunch_bundle "$app" "$relaunch"; then
  abort "new app did not stay open"
fi

rm -rf "$backup"
cleanup_stage
log_line "update applied"
exit 0
