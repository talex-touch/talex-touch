#!/bin/bash
set -eu
BACKUP_APP=""
DEST_APP=""
SWAP_HELPER=""
OLD_VERSION=""
FAILED_VERSION=""
LOG_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --backup) BACKUP_APP="$2"; shift 2 ;;
    --dest) DEST_APP="$2"; shift 2 ;;
    --swap-helper) SWAP_HELPER="$2"; shift 2 ;;
    --version) OLD_VERSION="$2"; shift 2 ;;
    --failed-version) FAILED_VERSION="$2"; shift 2 ;;
    --log) LOG_FILE="$2"; shift 2 ;;
    *) echo "Unknown restore argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$BACKUP_APP" ] && [ -n "$DEST_APP" ] && [ -x "$SWAP_HELPER" ] && [ -n "$OLD_VERSION" ] && [ -n "$FAILED_VERSION" ] && [ -n "$LOG_FILE" ] || exit 2
[ "$OLD_VERSION" != "$FAILED_VERSION" ] || exit 2
[ -d "$DEST_APP" ] && [ ! -L "$DEST_APP" ] && [ -d "$BACKUP_APP" ] && [ ! -L "$BACKUP_APP" ] || exit 1
log() {
  printf '[self-update] %s %s\n' "$(/bin/date +%s)" "$*" >> "$LOG_FILE"
}
version() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$1/Contents/Info.plist"
}
log "phase=recovery status=started"
current=$(version "$DEST_APP")
backup=$(version "$BACKUP_APP")
if [ "$current" = "$OLD_VERSION" ] && [ "$backup" = "$FAILED_VERSION" ]; then
  log "phase=recovery status=already-restored"
elif [ "$current" = "$FAILED_VERSION" ] && [ "$backup" = "$OLD_VERSION" ]; then
  started=$SECONDS
  "$SWAP_HELPER" --swap "$BACKUP_APP" "$DEST_APP" >> "$LOG_FILE" 2>&1
  log "phase=recovery status=restored durationSeconds=$((SECONDS - started))"
else
  log "phase=recovery status=failed reason=version-mismatch"
  exit 1
fi
# Keep the failed target for diagnosis until recovery startup has acknowledged this attempt.
open "$DEST_APP" >> "$LOG_FILE" 2>&1
