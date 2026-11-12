import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {NotificationDestroyedReason} from 'resource:///org/gnome/shell/ui/messageTray.js';

import {makeRecord, findRecordToLink} from './core/record.js';
import {toPlainText} from './core/text.js';

function guarded(fn) {
    return (...args) => {
        try {
            fn(...args);
        } catch (e) {
            console.error(e);
        }
    };
}

// Gio crashes the process serialising a themed icon with no names; an
// app can send one, so it counts as no icon.
function iconString(icon) {
    if (!icon)
        return null;
    if (icon instanceof Gio.ThemedIcon && icon.get_names().length === 0)
        return null;
    return icon.to_string();
}

// A source may set `datetime` to null; the record then takes the current time.
function unixTime(n) {
    return n.datetime?.to_unix() ?? Math.floor(Date.now() / 1000);
}

export class Recorder {
    constructor({store, sessionId}) {
        this._store = store;
        this._sessionId = sessionId;
        this._tray = null;
        this._trayIds = [];
        this._sources = new Map();         // source -> handler ids
        this._notifications = new Map();   // notification -> {id, handlers}
        this._subs = new Set();
    }

    enable() {
        this._tray = Main.messageTray;
        this._trayIds = [
            this._tray.connect('source-added', guarded((_t, source) => this._watchSource(source))),
            this._tray.connect('source-removed', guarded((_t, source) => this._unwatchSource(source))),
        ];
        for (const source of this._tray.getSources())
            guarded(this._watchSource.bind(this))(source);
    }

    disable() {
        if (this._tray) {
            for (const id of this._trayIds)
                this._tray.disconnect(id);
        }
        this._trayIds = [];
        this._tray = null;
        for (const source of [...this._sources.keys()])
            this._unwatchSource(source);
        for (const n of [...this._notifications.keys()])
            this._forget(n);
        this._subs.clear();
    }

    liveIds() {
        return new Set([...this._notifications.values()].map(e => e.id));
    }

    actionIds() {
        const ids = new Set();
        for (const [n, e] of this._notifications) {
            if (n.actions.length > 0)
                ids.add(e.id);
        }
        return ids;
    }

    getNotification(id) {
        for (const [n, e] of this._notifications) {
            if (e.id === id)
                return n;
        }
        return null;
    }

    activate(id) {
        this.getNotification(id)?.activate();
    }

    dismiss(id) {
        this.getNotification(id)?.destroy(NotificationDestroyedReason.DISMISSED);
    }

    subscribe(fn) {
        this._subs.add(fn);
        return () => this._subs.delete(fn);
    }

    _emit() {
        for (const fn of [...this._subs]) {
            try {
                fn();
            } catch (e) {
                console.error(e);
            }
        }
    }

    _watchSource(source) {
        if (this._sources.has(source))
            return;
        this._sources.set(source, [
            source.connect('notification-added', guarded((_s, n) => this._watch(source, n))),
            source.connect('notification-removed', guarded((_s, n) => this._forget(n, true))),
        ]);
        for (const n of [...source.notifications])
            guarded(this._watch.bind(this))(source, n);
    }

    _unwatchSource(source) {
        const ids = this._sources.get(source);
        if (!ids)
            return;
        this._sources.delete(source);
        for (const id of ids)
            source.disconnect(id);
    }

    _appId(source) {
        try {
            // Fdo sources expose a public `app` (Shell.App; id has the .desktop suffix).
            const appId = source.app?.get_id();
            if (appId)
                return appId;
            // Gtk app sources carry NotificationApplicationPolicy, whose public `id`
            // is the app id without suffix. The generic policy has id 'generic', which
            // no installed app matches, so the lookup below yields null for it.
            const id = source.policy?.id;
            if (typeof id === 'string' && id !== '') {
                const desktopId = `${id}.desktop`;
                if (Shell.AppSystem.get_default().lookup_app(desktopId))
                    return desktopId;
            }
        } catch (e) {
            console.error(e);
        }
        return null;
    }

    _fields(source, n) {
        const appId = this._appId(source);
        return {
            appName: source.title,
            appId,
            icon: iconString(n.gicon) ?? iconString(source.icon) ?? null,
            title: n.title,
            body: n.body,
            isMarkup: n.useBodyMarkup,
            time: unixTime(n),
            urgency: n.urgency,
        };
    }

    _watch(source, n) {
        if (this._notifications.has(n) || n.isTransient)
            return;
        const fields = this._fields(source, n);
        let rec = findRecordToLink(this._store.records, fields, this._sessionId, this.liveIds());
        if (!rec) {
            rec = makeRecord(fields, this._sessionId, GLib.uuid_string_random);
            this._store.add(rec);
        } else if (rec.sessionId !== this._sessionId) {
            // Restored by the Shell at login: adopt it, so it is saved as this session's.
            this._store.update(rec.id, {sessionId: this._sessionId});
        }
        const id = rec.id;
        const update = (patch) => this._store.update(id, patch);   // false when pruned: ignored
        const handlers = [
            n.connect('notify::title', guarded(() => update({title: toPlainText(n.title, false)}))),
            n.connect('notify::body', guarded(() =>
                update({body: toPlainText(n.body, !!n.useBodyMarkup)}))),
            n.connect('notify::datetime', guarded(() => update({time: unixTime(n)}))),
            n.connect('action-added', guarded(() => this._emit())),
            n.connect('action-removed', guarded(() => this._emit())),
            n.connect('destroy', guarded(() => this._forget(n, true))),
        ];
        this._notifications.set(n, {id, handlers});
        this._emit();
    }

    _forget(n, notify = false) {
        const e = this._notifications.get(n);
        if (!e)
            return;
        this._notifications.delete(n);
        for (const h of e.handlers) {
            try {
                n.disconnect(h);
            } catch (err) {
                console.error(err);
            }
        }
        if (notify)
            this._emit();
    }
}
