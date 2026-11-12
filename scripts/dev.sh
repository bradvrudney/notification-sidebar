#!/usr/bin/env bash
# Development Shell in a window, isolated from the live session: its own
# data, config and cache directories (so its settings and extensions are
# separate from yours) and its own D-Bus session. The real XDG_RUNTIME_DIR is
# kept because the devkit window has to reach your display.
# Set NS_DEV_PREFS=1 to also open the preferences window once the Shell is up.
UUID="notification-sidebar@bradvrudney.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${NS_DEV_INNER:-}" ]; then
    if [ ! -x /usr/libexec/mutter-devkit ]; then
        echo "dev: the Mutter development kit is not installed, so 'gnome-shell --devkit' cannot run." >&2
        echo "dev: on Fedora install it with: sudo dnf install mutter-devkit" >&2
        exit 1
    fi
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    mkdir -p "$TMP/data" "$TMP/config" "$TMP/cache"
    export NS_DEV_INNER=1 NS_DEV_TMP="$TMP"
    export XDG_DATA_HOME="$TMP/data" XDG_CONFIG_HOME="$TMP/config" XDG_CACHE_HOME="$TMP/cache"
    export DCONF_PROFILE=/dev/null GSETTINGS_BACKEND=keyfile
    dbus-run-session -- bash "${BASH_SOURCE[0]}"
    exit $?
fi

SHELL_PID=""
trap '[ -n "$SHELL_PID" ] && kill "$SHELL_PID" 2>/dev/null' EXIT

make -C "$ROOT" install DEST="$XDG_DATA_HOME/gnome-shell/extensions/$UUID" || exit 1
gsettings set org.gnome.shell enabled-extensions "['$UUID']" || exit 1

gnome-shell --devkit &
SHELL_PID=$!

if [ -n "${NS_DEV_PREFS:-}" ]; then
    sleep 5
    gnome-extensions prefs "$UUID"
fi
wait "$SHELL_PID"
