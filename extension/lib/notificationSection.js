import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {ensureActorVisibleInScrollView} from 'resource:///org/gnome/shell/misc/animationUtils.js';

import {buildView, VIEWS} from './core/viewModels.js';
import {createItemActor} from './rows.js';

const DEFAULT_VIEW = 'new-then-history';

const EMPTY_TEXT = {
    'none': 'No notifications yet',
    'no-match': 'Nothing matches',
};

function lookupApp(appId) {
    return appId ? Shell.AppSystem.get_default().lookup_app(appId) : null;
}

// Row containers (cards, lines and "more" buttons) in display order.
function rowsIn(actor) {
    const rows = [];
    const walk = a => {
        for (const child of a.get_children()) {
            if (child instanceof St.Widget && child.has_style_class_name('ns-row'))
                rows.push(child);
            else
                walk(child);
        }
    };
    walk(actor);
    return rows;
}

function firstFocusable(actor) {
    if (actor instanceof St.Widget && actor.can_focus)
        return actor;
    for (const child of actor.get_children()) {
        const found = firstFocusable(child);
        if (found)
            return found;
    }
    return null;
}

function scrollViewOf(actor) {
    for (let a = actor.get_parent(); a; a = a.get_parent()) {
        if (a instanceof St.ScrollView)
            return a;
    }
    return null;
}

export class NotificationSection {
    /**
     * `closePanel` closes the panel through its own `close()` (which releases
     * the modal grab); it is called after a row is activated.
     */
    constructor({store, recorder, settings, sessionId, now, closePanel}) {
        this._store = store;
        this._recorder = recorder;
        this._settings = settings;
        this._sessionId = sessionId;
        this._now = now;
        this._closePanel = closePanel;
        this._query = '';
        this._expanded = new Set();
        this._heldLastSeen = null;
        this._idleId = 0;
        this._destroyed = false;

        this.actor = new St.BoxLayout({
            style_class: 'ns-section',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });

        this._handlers = {
            onActivate: record => this._activate(record),
            onRemove: record => this._remove(record),
            onAction: (_record, action) => action.activate(),
            onMore: key => {
                this._expanded.add(key);
                this.refresh();
            },
            canActivate: item => item.isLive || !!lookupApp(item.record.appId),
            getActions: record => this._recorder.getNotification(record.id)?.actions ?? [],
        };

        this._unsubscribeStore = store.subscribe(() => this.refresh());
        this._unsubscribeRecorder = recorder.subscribe(() => this.refresh());
        this._viewId = settings.connect('changed::view', () => this.refresh());
        this._focusId = global.stage.connect('notify::key-focus', () => this._onKeyFocus());

        this.refresh();
    }

    setQuery(text) {
        this._query = text ?? '';
        this.refresh();
    }

    // While the panel is open the "new" divider stays where it was when the
    // panel opened, even though records keep arriving.
    setOpen(open) {
        this._heldLastSeen = open ? this._store.lastSeen : null;
        this.refresh();
    }

    resetExpanded() {
        this._expanded.clear();
        this.refresh();
    }

    // Store, recorder, setting and query changes can arrive in bursts, and
    // some fire synchronously from inside a row's click handler (activating
    // a notification destroys it). Rebuilding at idle coalesces them and
    // never destroys the actor whose handler is still running.
    refresh() {
        if (this._destroyed || this._idleId)
            return;
        this._idleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._idleId = 0;
            if (!this._destroyed)
                this._rebuild();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;
        if (this._idleId) {
            GLib.source_remove(this._idleId);
            this._idleId = 0;
        }
        this._unsubscribeStore?.();
        this._unsubscribeRecorder?.();
        this._settings.disconnect(this._viewId);
        global.stage.disconnect(this._focusId);
        this.actor.destroy();
        this.actor = null;
    }

    _view() {
        const view = this._settings.get_string('view');
        return VIEWS.includes(view) ? view : DEFAULT_VIEW;
    }

    _context() {
        return {
            now: this._now(),
            lastSeen: this._heldLastSeen ?? this._store.lastSeen,
            sessionId: this._sessionId,
            liveIds: this._recorder.liveIds(),
            actionIds: this._recorder.actionIds(),
            query: this._query,
            expanded: this._expanded,
        };
    }

    _rebuild() {
        try {
            const focusIndex = this._focusedRowIndex();
            const vm = buildView(this._view(), this._store.records, this._context());

            this.actor.destroy_all_children();
            if (vm.empty) {
                this.actor.add_child(new St.Label({
                    style_class: 'ns-empty',
                    text: EMPTY_TEXT[vm.empty],
                    x_align: Clutter.ActorAlign.CENTER,
                }));
            }
            for (const item of vm.items)
                this.actor.add_child(createItemActor(item, this._handlers));

            if (focusIndex !== null)
                this._restoreFocus(focusIndex);
        } catch (e) {
            console.error(`notification-sidebar: could not draw the list: ${e.message}`);
            console.error(e);
        }
    }

    // Index of the row holding keyboard focus, or null when focus is not in
    // this section.
    _focusedRowIndex() {
        const focus = global.stage.key_focus;
        if (!focus || !this.actor.contains(focus))
            return null;
        const rows = rowsIn(this.actor);
        const i = rows.findIndex(r => r.contains(focus));
        return i < 0 ? 0 : i;
    }

    // The focused row was just destroyed (removed, or a "more" row that
    // expanded); put focus on the row that took its place so keyboard
    // navigation carries on from there instead of falling to the stage.
    _restoreFocus(index) {
        const rows = rowsIn(this.actor);
        const target = rows.length ? firstFocusable(rows[Math.min(index, rows.length - 1)]) : null;
        if (target)
            target.grab_key_focus();
        else
            this.actor.grab_key_focus();
    }

    _onKeyFocus() {
        const focus = global.stage.key_focus;
        if (this._destroyed || !focus || focus === this.actor || !this.actor.contains(focus))
            return;
        const view = scrollViewOf(this.actor);
        if (!view)
            return;
        try {
            ensureActorVisibleInScrollView(view, focus);
        } catch (e) {
            console.error(e);
        }
    }

    _activate(record) {
        try {
            if (this._recorder.getNotification(record.id))
                this._recorder.activate(record.id);
            else
                lookupApp(record.appId)?.activate();
        } finally {
            this._closePanel();
        }
    }

    _remove(record) {
        this._recorder.dismiss(record.id);
        this._store.remove(record.id);
    }
}
