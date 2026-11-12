#!/usr/bin/env bash
# Development Shell in a window, isolated from the live session: its own
# data, config and cache directories (so its settings and extensions are
# separate from yours) and its own D-Bus session.
#
# The runtime directory is private too. Services that the new session bus
# starts (xdg-document-portal, gvfs) put FUSE mounts under XDG_RUNTIME_DIR,
# and with the real one they would target your live session's mounts. The
# devkit window still has to reach your compositor, so the original Wayland
# socket is passed as an absolute path in WAYLAND_DISPLAY, which libwayland
# accepts.
# Set NS_DEV_PREFS=1 to also open the preferences window once the Shell is up.
UUID="notification-sidebar@bradvrudney.github.io"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -z "${NS_DEV_INNER:-}" ]; then
    if [ ! -x /usr/libexec/mutter-devkit ]; then
        echo "dev: the Mutter development kit is not installed, so 'gnome-shell --devkit' cannot run." >&2
        echo "dev: on Fedora install it with: sudo dnf install mutter-devkit" >&2
        exit 1
    fi
    # Capture the display before the runtime dir is replaced.
    case "${WAYLAND_DISPLAY:-}" in
        /*) SOCKET="$WAYLAND_DISPLAY" ;;
        "") SOCKET="" ;;
        *) SOCKET="${XDG_RUNTIME_DIR:-}/$WAYLAND_DISPLAY" ;;
    esac
    if [ -z "$SOCKET" ] || [ ! -S "$SOCKET" ]; then
        echo "dev: no Wayland socket found (WAYLAND_DISPLAY='${WAYLAND_DISPLAY:-}'). Run this from a Wayland session." >&2
        exit 1
    fi
    TMP="$(mktemp -d)"
    rm_tmp() {
        for _ in 1 2 3 4 5 6 7 8 9 10; do
            for m in "$TMP"/runtime/gvfs "$TMP"/runtime/doc; do
                fusermount3 -uz "$m" 2>/dev/null
            done
            rm -rf "$TMP" 2>/dev/null && return 0
            sleep 0.5
        done
        echo "dev: could not remove $TMP" >&2
    }
    trap rm_tmp EXIT
    mkdir -p "$TMP/data" "$TMP/config" "$TMP/cache" "$TMP/runtime"
    chmod 700 "$TMP/runtime"
    export NS_DEV_INNER=1 NS_DEV_TMP="$TMP"
    export XDG_DATA_HOME="$TMP/data" XDG_CONFIG_HOME="$TMP/config" XDG_CACHE_HOME="$TMP/cache"
    export XDG_RUNTIME_DIR="$TMP/runtime" WAYLAND_DISPLAY="$SOCKET"
    export DCONF_PROFILE=/dev/null GSETTINGS_BACKEND=keyfile
    dbus-run-session -- bash "${BASH_SOURCE[0]}"
    exit $?
fi

SHELL_PID=""
trap 'if [ -n "$SHELL_PID" ]; then kill "$SHELL_PID" 2>/dev/null; wait "$SHELL_PID" 2>/dev/null; fi' EXIT

make -C "$ROOT" install DEST="$XDG_DATA_HOME/gnome-shell/extensions/$UUID" || exit 1
gsettings set org.gnome.shell enabled-extensions "['$UUID']" || exit 1

gnome-shell --devkit &
SHELL_PID=$!

if [ -n "${NS_DEV_PREFS:-}" ]; then
    ready=""
    for _ in $(seq 1 60); do
        kill -0 "$SHELL_PID" 2>/dev/null || break
        if gnome-extensions info "$UUID" 2>/dev/null | grep -q "State: ACTIVE"; then
            ready=1; break
        fi
        sleep 0.5
    done
    if [ -n "$ready" ]; then
        gnome-extensions prefs "$UUID"
    else
        echo "dev: the extension did not become active in 30 seconds; not opening preferences." >&2
        echo "dev: run 'gnome-extensions prefs $UUID' from a shell in this session, or check the Shell's output above." >&2
    fi
fi
wait "$SHELL_PID"
