#!/bin/bash
set -eu

SOURCE_PACKAGE=""
STAGE_ROOT=""
TARGET_VERSION=""
BUNDLE_ID=""
LOG_FILE=""
CHILD_PID=""
MOUNTED=0

while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE_PACKAGE="$2"; shift 2 ;;
    --stage) STAGE_ROOT="$2"; shift 2 ;;
    --version) TARGET_VERSION="$2"; shift 2 ;;
    --bundle-id) BUNDLE_ID="$2"; shift 2 ;;
    --log) LOG_FILE="$2"; shift 2 ;;
    *) echo "Unknown preparation argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SOURCE_PACKAGE" ] && [ -n "$STAGE_ROOT" ] && [ -n "$TARGET_VERSION" ] && [ -n "$BUNDLE_ID" ] && [ -n "$LOG_FILE" ] || exit 2
[ -d "$STAGE_ROOT" ] && [ ! -L "$STAGE_ROOT" ] || exit 2
WORK_APP="$STAGE_ROOT/prepared.app"
MOUNT_DIR="$STAGE_ROOT/mount"
EXTRACT_DIR="$STAGE_ROOT/extract"

log() {
  printf '[self-update] %s %s\n' "$(/bin/date +%s)" "$*" >> "$LOG_FILE"
}
run_phase() {
  local phase="$1" started=$SECONDS result=0
  shift
  log "phase=$phase status=started"
  "$@" >> "$LOG_FILE" 2>&1 &
  CHILD_PID=$!
  wait "$CHILD_PID" || result=$?
  CHILD_PID=""
  log "phase=$phase status=finished durationSeconds=$((SECONDS - started)) exitCode=$result"
  return "$result"
}
cleanup() {
  if [ -n "$CHILD_PID" ]; then
    kill -TERM "$CHILD_PID" 2>/dev/null || true
    wait "$CHILD_PID" 2>/dev/null || true
  fi
  if [ "$MOUNTED" -eq 1 ]; then
    /usr/bin/hdiutil detach "$MOUNT_DIR" -quiet >> "$LOG_FILE" 2>&1 || true
  fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# Only this attempt's private preparation directory is disposable; never the installed app.
rm -rf "$WORK_APP" "$EXTRACT_DIR" "$MOUNT_DIR"
case "$SOURCE_PACKAGE" in
  *.dmg|*.DMG)
    mkdir "$MOUNT_DIR"
    MOUNTED=1
    run_phase mount /usr/bin/hdiutil attach "$SOURCE_PACKAGE" -nobrowse -readonly -noverify -noautofsck -mountpoint "$MOUNT_DIR"
    SEARCH_ROOT="$MOUNT_DIR"
    ;;
  *.zip|*.ZIP)
    mkdir "$EXTRACT_DIR"
    run_phase extract /usr/bin/ditto -x -k "$SOURCE_PACKAGE" "$EXTRACT_DIR"
    SEARCH_ROOT="$EXTRACT_DIR"
    ;;
  *.app|*.APP)
    SEARCH_ROOT="$SOURCE_PACKAGE"
    ;;
  *) log "unsupported package"; exit 1 ;;
esac

CANDIDATE=""
while IFS= read -r -d '' candidate; do
  [ -z "$CANDIDATE" ] || { log "multiple application bundles in package"; exit 1; }
  CANDIDATE="$candidate"
done < <(/usr/bin/find "$SEARCH_ROOT" -maxdepth 4 -type d -name '*.app' -prune -print0)
[ -n "$CANDIDATE" ] || { log "application bundle missing"; exit 1; }
run_phase source-copy /usr/bin/ditto "$CANDIDATE" "$WORK_APP"
if [ "$MOUNTED" -eq 1 ]; then
  run_phase unmount /usr/bin/hdiutil detach "$MOUNT_DIR" -quiet
  MOUNTED=0
fi
actual_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$WORK_APP/Contents/Info.plist")
actual_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$WORK_APP/Contents/Info.plist")
[ "$actual_version" = "$TARGET_VERSION" ] && [ "$actual_id" = "$BUNDLE_ID" ] || { log "prepared application identity mismatch"; exit 1; }
run_phase bundle-verification /usr/bin/codesign --verify --deep --strict "$WORK_APP"
rm -rf "$EXTRACT_DIR" "$MOUNT_DIR"
log "phase=preparation status=ready"
