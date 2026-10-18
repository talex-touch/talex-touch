#!/bin/bash
set -eu

PREPARED_APP=""
DEST_APP=""
SWAP_HELPER=""
TARGET_VERSION=""
PREVIOUS_VERSION=""
APP_PID=""
LOG_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --prepared) PREPARED_APP="$2"; shift 2 ;;
    --dest) DEST_APP="$2"; shift 2 ;;
    --swap-helper) SWAP_HELPER="$2"; shift 2 ;;
    --version) TARGET_VERSION="$2"; shift 2 ;;
    --previous-version) PREVIOUS_VERSION="$2"; shift 2 ;;
    --pid) APP_PID="$2"; shift 2 ;;
    --log) LOG_FILE="$2"; shift 2 ;;
    *) echo "Unknown apply argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$PREPARED_APP" ] && [ -n "$DEST_APP" ] && [ -x "$SWAP_HELPER" ] && [ -n "$TARGET_VERSION" ] && [ -n "$PREVIOUS_VERSION" ] && [ -n "$APP_PID" ] && [ -n "$LOG_FILE" ] || exit 2
[ "$TARGET_VERSION" != "$PREVIOUS_VERSION" ] || exit 2
[ -d "$DEST_APP" ] && [ ! -L "$DEST_APP" ] && [ -d "$PREPARED_APP" ] && [ ! -L "$PREPARED_APP" ] || exit 1
log() {
  printf '[self-update] %s %s\n' "$(/bin/date +%s)" "$*" >> "$LOG_FILE"
}
version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$1/Contents/Info.plist"
}

log "phase=apply status=started"
# The coordinator/helper already waited for this exact parent. Never kill a recycled PID.
if kill -0 "$APP_PID" 2>/dev/null; then
  log "phase=apply status=failed reason=parent-still-running"
  exit 1
fi
current=$(version "$DEST_APP")
prepared=$(version "$PREPARED_APP")
if [ "$current" = "$TARGET_VERSION" ] && [ "$prepared" = "$PREVIOUS_VERSION" ]; then
  log "phase=swap status=already-applied"
elif [ "$current" = "$PREVIOUS_VERSION" ] && [ "$prepared" = "$TARGET_VERSION" ]; then
  started=$SECONDS
  log "phase=swap status=started"
  if ! "$SWAP_HELPER" --swap "$PREPARED_APP" "$DEST_APP" >> "$LOG_FILE" 2>&1; then
    log "phase=swap status=failed"
    open "$DEST_APP" >> "$LOG_FILE" 2>&1 || true
    exit 1
  fi
  log "phase=swap status=finished durationSeconds=$((SECONDS - started))"
else
  log "phase=apply status=failed reason=version-mismatch"
  exit 1
fi
# The old app is now PREPARED_APP. Keep it until a matching startup health acknowledgement.
log "phase=relaunch status=started"
open "$DEST_APP" >> "$LOG_FILE" 2>&1
log "phase=relaunch status=requested"
