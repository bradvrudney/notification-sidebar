import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {NotificationDestroyedReason} from 'resource:///org/gnome/shell/ui/messageTray.js';

import {makeRecord} from './core/record.js';
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
            this._watchSource(source);
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
            this._watch(source, n);
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
            icon: n.gicon?.to_string() ?? source.icon?.to_string() ?? null,
            title: n.title,
            body: n.body,
            isMarkup: n.useBodyMarkup,
            time: n.datetime.to_unix(),
            urgency: n.urgency,
        };
    }

    _watch(source, n) {
        if (this._notifications.has(n) || n.isTransient)
            return;
        const fields = this._fields(source, n);
        let rec = this._store.find(fields, this._sessionId);
        if (!rec) {
            rec = makeRecord(fields, this._sessionId, GLib.uuid_string_random);
            this._store.add(rec);
        }
        const id = rec.id;
        const update = (patch) => this._store.update(id, patch);   // false when pruned: ignored
        const handlers = [
            n.connect('notify::title', guarded(() => update({title: toPlainText(n.title, false)}))),
            n.connect('notify::body', guarded(() =>
                update({body: toPlainText(n.body, !!n.useBodyMarkup)}))),
            n.connect('notify::datetime', guarded(() => update({time: n.datetime.to_unix()}))),
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
