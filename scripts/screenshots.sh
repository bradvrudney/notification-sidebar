#!/usr/bin/env bash
# Regenerates docs/screenshots/*.png from a headless Shell that is fully
# isolated from the live session (same approach as scripts/smoke.sh): its own
# data, config, cache, state and runtime dirs, its own D-Bus session, and the
# keyfile settings backend.
UUID="notification-sidebar@bradvrudney.github.io"
DRIVER="ns-screenshot-driver@test.invalid"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${NS_SHOT_INNER:-}" ]; then
    TMP="$(mktemp -d)" || exit 1
    if [ -z "$TMP" ] || [ ! -d "$TMP" ]; then
        echo "screenshots: mktemp did not create a temp dir" >&2
        exit 1
    fi
    rm_tmp() {
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            for m in "$TMP"/runtime/gvfs "$TMP"/runtime/doc; do
                fusermount3 -uz "$m" 2>/dev/null
            done
            rm -rf --one-file-system "$TMP" 2>/dev/null && return 0
            sleep 0.5
        done
        echo "screenshots: could not remove $TMP" >&2
    }
    trap rm_tmp EXIT
    mkdir -p "$TMP/data" "$TMP/config" "$TMP/cache" "$TMP/state" "$TMP/runtime" "$TMP/out"
    chmod 700 "$TMP/runtime"
    export NS_SHOT_INNER=1 NS_SHOT_TMP="$TMP" NS_SHOT_OUT="$TMP/out"
    export XDG_DATA_HOME="$TMP/data" XDG_CONFIG_HOME="$TMP/config" XDG_CACHE_HOME="$TMP/cache"
    export XDG_STATE_HOME="$TMP/state" XDG_RUNTIME_DIR="$TMP/runtime"
    dbus-run-session -- bash "${BASH_SOURCE[0]}" || exit $?
    mkdir -p "$ROOT/docs/screenshots"
    cp "$TMP"/out/*.png "$ROOT/docs/screenshots/" || exit 1
    echo "screenshots: wrote"; ls "$ROOT/docs/screenshots"
    exit 0
fi

TMP="$NS_SHOT_TMP"
SHELL_PID=""
cleanup() {
    [ -n "$SHELL_PID" ] && kill "$SHELL_PID" 2>/dev/null && wait "$SHELL_PID" 2>/dev/null
}
trap cleanup EXIT
fail() { echo "SCREENSHOTS FAIL: $1"; [ -f "$TMP/shell.log" ] && tail -n 30 "$TMP/shell.log"; exit 1; }

export DCONF_PROFILE=/dev/null GSETTINGS_BACKEND=keyfile

# Every gsettings write below must land in the isolated keyfile store.
if [ -z "$TMP" ] || [ ! -d "$TMP" ]; then
    echo "screenshots: NS_SHOT_TMP is not a directory; refusing to continue" >&2
    exit 1
fi
case "${XDG_CONFIG_HOME:-}" in
    "$TMP"/?*) ;;
    *) echo "screenshots: XDG_CONFIG_HOME='${XDG_CONFIG_HOME:-}' is not under $TMP; refusing to write settings" >&2
       exit 1 ;;
esac
gsettings set org.gnome.desktop.media-handling automount false || fail "could not turn off automount"
gsettings set org.gnome.desktop.media-handling automount-open false || fail "could not turn off automount-open"
touch "$XDG_DATA_HOME/ns-screenshot-driver-marker" || fail "could not write the driver marker"

make -C "$ROOT" install DEST="$XDG_DATA_HOME/gnome-shell/extensions/$UUID" >"$TMP/install.log" 2>&1 \
    || fail "install failed: $(cat "$TMP/install.log")"
cp -r "$ROOT/tests/screenshot-driver" "$XDG_DATA_HOME/gnome-shell/extensions/$DRIVER" \
    || fail "driver install failed"

gnome-shell --headless --wayland-display ns-shot --virtual-monitor 1280x800 >"$TMP/shell.log" 2>&1 &
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
gnome-extensions info "$UUID" 2>&1 | grep -q "State: ACTIVE" || fail "extension not ACTIVE"
gnome-extensions enable "$DRIVER" || fail "driver enable failed"
for _ in $(seq 1 120); do
    grep -q '\[ns-screenshot-driver\] \(done\|FAIL\)' "$TMP/shell.log" && break
    sleep 0.5
done
grep -o '\[ns-screenshot-driver\] .*' "$TMP/shell.log"
grep -q '\[ns-screenshot-driver\] done' "$TMP/shell.log" || fail "driver did not finish"
if grep -n 'JS ERROR' "$TMP/shell.log"; then fail "JS ERROR in shell log"; fi
gnome-extensions disable "$DRIVER"
gnome-extensions disable "$UUID"
sleep 1
