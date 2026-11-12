#!/usr/bin/env bash
# Headless smoke check, fully isolated from the live session.
UUID="notification-sidebar@bradvrudney.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${NS_SMOKE_INNER:-}" ]; then
    # Outer: create the temp dir and run everything under it, with its own
    # runtime dir, so nothing touches the live session's /run/user/<uid>.
    TMP="$(mktemp -d)" || exit 1
    if [ -z "$TMP" ] || [ ! -d "$TMP" ]; then
        echo "smoke: mktemp did not create a temp dir" >&2
        exit 1
    fi
    # Session daemons (gvfs, document portal) may still hold FUSE mounts under
    # $TMP/runtime for a moment after the bus goes away. Unmount first (lazily),
    # then remove without crossing into any other file system; retry.
    rm_tmp() {
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            for m in "$TMP"/runtime/gvfs "$TMP"/runtime/doc; do
                fusermount3 -uz "$m" 2>/dev/null
            done
            rm -rf --one-file-system "$TMP" 2>/dev/null && return 0
            sleep 0.5
        done
        echo "smoke: could not remove $TMP" >&2
    }
    trap rm_tmp EXIT
    mkdir -p "$TMP/data" "$TMP/config" "$TMP/cache" "$TMP/state" "$TMP/runtime"
    chmod 700 "$TMP/runtime"
    export NS_SMOKE_INNER=1 NS_SMOKE_TMP="$TMP"
    export XDG_DATA_HOME="$TMP/data" XDG_CONFIG_HOME="$TMP/config" XDG_CACHE_HOME="$TMP/cache"
    export XDG_STATE_HOME="$TMP/state" XDG_RUNTIME_DIR="$TMP/runtime"
    dbus-run-session -- bash "${BASH_SOURCE[0]}"
    exit $?
fi

TMP="$NS_SMOKE_TMP"
SHELL_PID=""
MPRIS_PID=""
cleanup() {
    [ -n "$MPRIS_PID" ] && kill "$MPRIS_PID" 2>/dev/null && wait "$MPRIS_PID" 2>/dev/null
    [ -n "$SHELL_PID" ] && kill "$SHELL_PID" 2>/dev/null && wait "$SHELL_PID" 2>/dev/null
}
trap cleanup EXIT
fail() { echo "SMOKE FAIL: $1"; [ -f "$TMP/shell.log" ] && tail -n 30 "$TMP/shell.log"; exit 1; }

export DCONF_PROFILE=/dev/null GSETTINGS_BACKEND=keyfile

# Every gsettings write below must land in the isolated keyfile store.
if [ -z "$TMP" ] || [ ! -d "$TMP" ]; then
    echo "smoke: NS_SMOKE_TMP is not a directory; refusing to continue" >&2
    exit 1
fi
case "${XDG_CONFIG_HOME:-}" in
    "$TMP"/?*) ;;
    *) echo "smoke: XDG_CONFIG_HOME='${XDG_CONFIG_HOME:-}' is not under $TMP; refusing to write settings" >&2
       exit 1 ;;
esac
if [ "${GSETTINGS_BACKEND:-}" != keyfile ]; then
    echo "smoke: GSETTINGS_BACKEND is not keyfile; refusing to write settings" >&2
    exit 1
fi
# The nested Shell runs the stock automount manager; keep it from mounting
# anything (a gvfs mount would land under the temp runtime dir).
gsettings set org.gnome.desktop.media-handling automount false || fail "could not turn off automount"
gsettings set org.gnome.desktop.media-handling automount-open false || fail "could not turn off automount-open"
# Marker the test-only driver requires before it does anything.
touch "$XDG_DATA_HOME/ns-smoke-driver-marker" || fail "could not write the driver marker"

make -C "$ROOT" install DEST="$XDG_DATA_HOME/gnome-shell/extensions/$UUID" >"$TMP/install.log" 2>&1 \
    || fail "install failed: $(cat "$TMP/install.log")"
# Test-only driver (tests/smoke-driver), installed only here; the Shell finds
# extensions at startup, so it goes in now and is enabled later.
DRIVER="ns-smoke-driver@test.invalid"
cp -r "$ROOT/tests/smoke-driver" "$XDG_DATA_HOME/gnome-shell/extensions/$DRIVER" \
    || fail "driver install failed"

# A desktop entry for the GTK-notification check, inside the isolated data dir.
mkdir -p "$XDG_DATA_HOME/applications"
cat >"$XDG_DATA_HOME/applications/com.example.SmokeGtk.desktop" <<'DESK'
[Desktop Entry]
Type=Application
Name=Smoke Gtk
Exec=true
DESK

gnome-shell --headless --wayland-display ns-smoke --virtual-monitor 1280x800 >"$TMP/shell.log" 2>&1 &
SHELL_PID=$!

ready=""
for _ in $(seq 1 60); do
    kill -0 "$SHELL_PID" 2>/dev/null || fail "gnome-shell exited early"
    if gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner org.gnome.Shell 2>/dev/null | grep -q true; then
        ready=1; break
    fi
    sleep 0.5
done
[ -n "$ready" ] || fail "org.gnome.Shell never appeared on the bus"
sleep 2

gnome-extensions enable "$UUID" || fail "gnome-extensions enable failed"
sleep 2
info="$(gnome-extensions info "$UUID" 2>&1)"
echo "$info" | grep -q "State: ACTIVE" || fail "extension not ACTIVE: $info"

# Everything below runs inside the isolated dbus session started above.
notify-send -a SmokeApp "Hello smoke" "<b>body</b> one" || fail "notify-send failed"
notify-send -a SmokeApp -h boolean:transient:true "Transient" "x" || fail "notify-send (transient) failed"
gdbus call --session --dest org.gtk.Notifications --object-path /org/gtk/Notifications \
    --method org.gtk.Notifications.AddNotification com.example.SmokeGtk n1 \
    '{"title": <"Gtk smoke">, "body": <"gtk body">}' >/dev/null || fail "gtk AddNotification failed"
notify-send -a SmokeApp "Twin smoke" "same" || fail "notify-send twin 1 failed"
notify-send -a SmokeApp "Twin smoke" "same" || fail "notify-send twin 2 failed"
sleep 2
# Only JS errors and this extension's own errors count; the isolated session's
# environment noise (a11y bus, PipeWire, portals, evolution-dataserver, lost
# compositor connection) is not matched by either pattern.
check_log() {
    if grep -n 'JS ERROR' "$TMP/shell.log"; then fail "$1: JS ERROR in shell log"; fi
    if grep -n 'could not build the interface' "$TMP/shell.log"; then
        fail "$1: interface failed to build"
    fi
    if grep -n 'notification-sidebar' "$TMP/shell.log" | grep -i 'error'; then
        fail "$1: extension error in shell log"
    fi
    # Mutter names a keybinding it is asked to add twice (one that was not
    # restored, or restored over ours).
    if grep -n 'toggle-message-tray' "$TMP/shell.log"; then
        fail "$1: toggle-message-tray keybinding warning in shell log"
    fi
}
check_log "after enable and notifications"
grep -q 'notification-sidebar\] interface built' "$TMP/shell.log" || fail "interface was never built"
gnome-extensions disable "$UUID" || fail "disable failed"
sleep 1
gnome-extensions enable "$UUID" || fail "re-enable failed"
sleep 2
gnome-extensions disable "$UUID" || fail "final disable failed"
sleep 1
gnome-extensions info "$UUID" 2>&1 | grep -q "State: INACTIVE" || fail "extension not INACTIVE after disable"
check_log "after disable"

HIST="$XDG_DATA_HOME/notification-sidebar/history.json"
[ -f "$HIST" ] || fail "history file missing: $HIST"
[ "$(stat -c %a "$HIST")" = "600" ] || fail "history mode is $(stat -c %a "$HIST"), want 600"
python3 -I - "$HIST" <<'PY' || fail "history content check failed"
import json, sys
d = json.load(open(sys.argv[1]))
assert d["version"] == 1, d
hello = [r for r in d["records"] if r["title"] == "Hello smoke"]
assert len(hello) == 1, d["records"]
assert hello[0]["body"] == "body one", hello[0]
assert hello[0]["appName"] == "SmokeApp", hello[0]
assert len([r for r in d["records"] if r["title"] == "Twin smoke"]) == 2, d["records"]
gtk = [r for r in d["records"] if r["title"] == "Gtk smoke"]
assert len(gtk) == 1, d["records"]
assert gtk[0]["appId"] == "com.example.SmokeGtk.desktop", gtk[0]
assert not [r for r in d["records"] if r["title"] == "Transient"], d["records"]
PY

# A fake MPRIS player on the isolated bus, for the media section. The driver
# makes it quit; the cleanup trap kills it if it is still running.
gjs -m "$ROOT/tests/fake-mpris-player.js" >"$TMP/mpris.log" 2>&1 &
MPRIS_PID=$!
mpris=""
for _ in $(seq 1 20); do
    kill -0 "$MPRIS_PID" 2>/dev/null || fail "fake media player exited early: $(cat "$TMP/mpris.log")"
    if gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner org.mpris.MediaPlayer2.NsSmoke 2>/dev/null | grep -q true; then
        mpris=1; break
    fi
    sleep 0.5
done
[ -n "$mpris" ] || fail "fake media player never appeared on the bus"

# Drive the list with virtual pointer and keyboard input: clicks, hover,
# Tab order, keyboard remove, views, search, more, clear all, then the media
# section, Super+V and the clock-menu takeover across disable/enable. The
# extension reloads the history checked above. The driver ends with "done".
gnome-extensions enable "$UUID" || fail "enable for driver failed"
sleep 2
gnome-extensions enable "$DRIVER" || fail "driver enable failed"
for _ in $(seq 1 120); do
    grep -q '\[ns-smoke-driver\] done' "$TMP/shell.log" && break
    sleep 0.5
done
grep -q '\[ns-smoke-driver\] done' "$TMP/shell.log" || fail "driver did not finish"
echo "smoke: driver checks:"
grep -o '\[ns-smoke-driver\] .*' "$TMP/shell.log"
if grep -q '\[ns-smoke-driver\] FAIL' "$TMP/shell.log"; then fail "driver check failed"; fi
grep -q '\[ns-smoke-driver\] ok closed at end' "$TMP/shell.log" || fail "driver stopped early"
grep -q '\[ns-smoke-driver\] ok takeover checks finished' "$TMP/shell.log" \
    || fail "driver stopped before the takeover checks finished"
kill -0 "$MPRIS_PID" 2>/dev/null && fail "fake media player still running: the driver did not quit it"
wait "$MPRIS_PID" 2>/dev/null
MPRIS_PID=""
gnome-extensions disable "$DRIVER" || fail "driver disable failed"
gnome-extensions disable "$UUID" || fail "disable after driver failed"
sleep 1
check_log "after driver"
echo "smoke: shell log lines mentioning the extension:"
grep -n "notification-sidebar" "$TMP/shell.log" | sed -n 1,20p
echo "SMOKE OK"
