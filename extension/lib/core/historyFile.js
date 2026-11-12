import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

export function historyPath() {
    return `${GLib.get_user_data_dir()}/notification-sidebar/history.json`;
}

// Never throws. Returns {data, quarantined, preserve}:
// - missing file: no data;
// - unreadable or unparseable file: renamed aside (`quarantined` is the new
//   path) and no data;
// - if it could not be renamed aside, `preserve` is true: the file is still
//   at `path` and must not be overwritten, so the caller must not save.
export function loadHistory(path, {onError = console.error} = {}) {
    const unusable = () => {
        const quarantined = quarantineHistory(path, {onError});
        return {data: null, quarantined, preserve: quarantined === null};
    };
    let text;
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return {data: null, quarantined: null, preserve: false};
        text = new TextDecoder().decode(bytes);
    } catch (e) {
        if (e.matches?.(GLib.FileError, GLib.FileError.NOENT))
            return {data: null, quarantined: null, preserve: false};
        onError(`notification-sidebar: cannot read ${path}: ${e.message}`);
        return unusable();
    }

    try {
        const data = JSON.parse(text);
        if (data === null || typeof data !== 'object' || Array.isArray(data))
            throw new Error('not an object');
        return {data, quarantined: null, preserve: false};
    } catch (e) {
        onError(`notification-sidebar: corrupt history ${path}: ${e.message}`);
        return unusable();
    }
}

// Never throws. Moves an unusable history file aside; returns the new path or null.
export function quarantineHistory(path, {onError = console.error} = {}) {
    const quarantined = `${path}.corrupt-${Math.floor(Date.now() / 1000)}`;
    try {
        Gio.File.new_for_path(path).move(
            Gio.File.new_for_path(quarantined), Gio.FileCopyFlags.OVERWRITE, null, null);
        return quarantined;
    } catch (e) {
        onError(`notification-sidebar: cannot quarantine ${path}: ${e.message}`);
        return null;
    }
}

// Never throws. Atomic, owner-only write. Returns success.
export function saveHistory(path, obj, {onError = console.error} = {}) {
    try {
        const file = Gio.File.new_for_path(path);
        GLib.mkdir_with_parents(file.get_parent().get_path(), 0o700);
        const bytes = new TextEncoder().encode(JSON.stringify(obj));
        file.replace_contents(
            bytes, null, false,
            Gio.FileCreateFlags.REPLACE_DESTINATION | Gio.FileCreateFlags.PRIVATE, null);
        return true;
    } catch (e) {
        onError(`notification-sidebar: cannot save ${path}: ${e.message}`);
        return false;
    }
}

export class DebouncedSaver {
    constructor(saveFn, {
        delayMs = 2000,
        setTimer = (fn, ms) => GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            fn();
            return GLib.SOURCE_REMOVE;
        }),
        clearTimer = id => GLib.source_remove(id),
    } = {}) {
        this._saveFn = saveFn;
        this._delayMs = delayMs;
        this._setTimer = setTimer;
        this._clearTimer = clearTimer;
        this._timer = null;
        this._destroyed = false;
    }

    schedule() {
        if (this._destroyed || this._timer !== null)
            return;
        this._timer = this._setTimer(() => {
            this._timer = null;
            this._saveFn();
        }, this._delayMs);
    }

    flush() {
        if (this._timer === null)
            return;
        this._clearTimer(this._timer);
        this._timer = null;
        this._saveFn();
    }

    destroy() {
        this.flush();
        this._destroyed = true;
    }
}
