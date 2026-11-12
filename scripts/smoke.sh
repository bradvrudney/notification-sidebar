#!/usr/bin/env bash
# Headless smoke check, fully isolated from the live session.
UUID="notification-sidebar@bradvrudney.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${NS_SMOKE_INNER:-}" ]; then
    export NS_SMOKE_INNER=1 NS_SMOKE_ROOT="$ROOT"
    exec dbus-run-session -- bash "${BASH_SOURCE[0]}"
fi

TMP="$(mktemp -d)"
SHELL_PID=""
cleanup() {
    [ -n "$SHELL_PID" ] && kill "$SHELL_PID" 2>/dev/null && wait "$SHELL_PID" 2>/dev/null
    rm -rf "$TMP"
}
trap cleanup EXIT
fail() { echo "SMOKE FAIL: $1"; [ -f "$TMP/shell.log" ] && tail -n 30 "$TMP/shell.log"; exit 1; }

mkdir -p "$TMP/data" "$TMP/config" "$TMP/cache" "$TMP/runtime"
chmod 700 "$TMP/runtime"
export XDG_DATA_HOME="$TMP/data" XDG_CONFIG_HOME="$TMP/config" XDG_CACHE_HOME="$TMP/cache"
export DCONF_PROFILE=/dev/null GSETTINGS_BACKEND=keyfile

make -C "$ROOT" install DEST="$XDG_DATA_HOME/gnome-shell/extensions/$UUID" >"$TMP/install.log" 2>&1 \
    || fail "install failed: $(cat "$TMP/install.log")"

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
echo "SMOKE OK"
