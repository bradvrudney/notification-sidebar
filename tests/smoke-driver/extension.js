// Test-only extension, installed by scripts/smoke.sh into its isolated data
// dir. It drives the sidebar of notification-sidebar@bradvrudney.github.io
// with Clutter virtual input devices (real pointer and key events through
// the Shell's picking, gestures and focus manager) and logs one line per
// check: `[ns-smoke-driver] ok <name>` or `[ns-smoke-driver] FAIL <name>`,
// then `[ns-smoke-driver] done`. It reaches into the target's own fields
// (`_panel`, `_section`, ...) because there is no other way in.
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const TARGET = 'notification-sidebar@bradvrudney.github.io';
const TAG = '[ns-smoke-driver]';
const SETTLE_MS = 400;

function descendants(actor, pred) {
    const out = [];
    const walk = a => {
        for (const child of a.get_children()) {
            if (pred(child))
                out.push(child);
            walk(child);
        }
    };
    walk(actor);
    return out;
}

const hasClass = name => a => a instanceof St.Widget && a.has_style_class_name(name);
const texts = actor => descendants(actor, a => a instanceof St.Label || a instanceof St.Button)
    .map(a => a instanceof St.Button ? a.label : a.text)
    .filter(t => t);

export default class SmokeDriver extends Extension {
    enable() {
        this._timers = new Set();
        this._cancelled = false;
        this._sources = [];
        const seat = global.stage.context.get_backend().get_default_seat();
        this._pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        this._keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        this._run()
            .catch(e => console.log(`${TAG} FAIL crashed: ${e.message}\n${e.stack}`))
            .finally(() => console.log(`${TAG} done`));
    }

    disable() {
        this._cancelled = true;
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
        for (const source of this._sources)
            source.destroy();
        this._sources = [];
        this._pointer = null;
        this._keyboard = null;
    }

    _wait(ms = SETTLE_MS) {
        return new Promise((resolve, reject) => {
            const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._timers.delete(id);
                if (this._cancelled)
                    reject(new Error('cancelled'));
                else
                    resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._timers.add(id);
        });
    }

    _check(name, cond, detail = '') {
        console.log(`${TAG} ${cond ? 'ok' : 'FAIL'} ${name}${cond ? '' : `: ${detail}`}`);
    }

    async _moveTo(actor) {
        const [x, y] = actor.get_transformed_position();
        const [w, h] = actor.get_transformed_size();
        await this._pointTo(x + w / 2, y + h / 2);
    }

    // The first absolute motion from a new virtual device can land on one
    // axis only; repeat until the pointer is where it was sent.
    async _pointTo(x, y) {
        for (let i = 0; i < 5; i++) {
            this._pointer.notify_absolute_motion(GLib.get_monotonic_time(), x, y);
            await this._wait(100);
            const [px, py] = global.get_pointer();
            if (Math.abs(px - x) <= 1 && Math.abs(py - y) <= 1)
                return;
        }
        throw new Error(`pointer did not reach ${x},${y}`);
    }

    async _click(actor) {
        await this._moveTo(actor);
        this._pointer.notify_button(GLib.get_monotonic_time(),
            Clutter.BUTTON_PRIMARY, Clutter.ButtonState.PRESSED);
        await this._wait(50);
        this._pointer.notify_button(GLib.get_monotonic_time(),
            Clutter.BUTTON_PRIMARY, Clutter.ButtonState.RELEASED);
        await this._wait();
    }

    async _key(keyval) {
        this._keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.PRESSED);
        await this._wait(30);
        this._keyboard.notify_keyval(GLib.get_monotonic_time(), keyval, Clutter.KeyState.RELEASED);
        await this._wait();
    }

    _notify(title, actionLabel = null) {
        const source = new MessageTray.Source({
            title: 'Driver',
            iconName: 'dialog-information-symbolic',
        });
        // A source destroys itself once its last notification goes.
        source.connect('destroy', () => {
            this._sources = this._sources.filter(s => s !== source);
        });
        Main.messageTray.add(source);
        this._sources.push(source);
        const n = new MessageTray.Notification({source, title, body: `${title} body`});
        const counts = {activated: 0, action: 0};
        n.connect('activated', () => counts.activated++);
        if (actionLabel)
            n.addAction(actionLabel, () => counts.action++);
        source.addNotification(n);
        return counts;
    }

    // Polls until `pred()` holds; returns the elapsed ms, or -1 on timeout.
    async _waitFor(pred, timeoutMs) {
        const start = GLib.get_monotonic_time();
        for (;;) {
            const elapsed = (GLib.get_monotonic_time() - start) / 1000;
            if (pred())
                return elapsed;
            if (elapsed > timeoutMs)
                return -1;
            await this._wait(50);
        }
    }

    _rowWithTitle(title) {
        return descendants(this._section.actor, hasClass('ns-row'))
            .find(r => texts(r).includes(title)) ?? null;
    }

    async _run() {
        const ext = Main.extensionManager.lookup(TARGET)?.stateObj;
        if (!ext?._section || !ext._panel)
            throw new Error('target extension or its interface is missing');
        this._section = ext._section;
        const panel = ext._panel;
        const store = ext._store;
        const recorder = ext._recorder;
        const settings = ext._settings;
        const section = () => this._section.actor;

        settings.set_string('view', 'new-then-history');
        await this._wait();
        // A fresh Shell starts in the overview with its welcome dialog up;
        // both hold modal grabs and cover the panel.
        for (const dialog of Main.layoutManager.modalDialogGroup.get_children())
            dialog.close?.();
        Main.overview.hide();
        await this._wait(1500);
        this._check('no modal left from startup', Main.modalCount === 0, `${Main.modalCount}`);

        // Nothing is built while the panel is closed, whatever changes.
        const rowCount = () => descendants(section(), hasClass('ns-row')).length;
        settings.set_string('view', 'timeline');
        store.update(store.records[0].id, {});
        await this._wait();
        this._check('no row actors while closed', section().get_n_children() === 0,
            `${section().get_n_children()} children`);
        settings.set_string('view', 'new-then-history');

        // Opening builds the rows at once, before the slide-in.
        panel.open();
        const all = texts(section());
        this._check('rows built on open, synchronously',
            all.includes('Twin smoke') && all.includes('Gtk smoke'), JSON.stringify(all));
        this._check('new heading', all.includes('New'), JSON.stringify(all));
        this._check('more-new row', all.includes('Show 1 more new'), JSON.stringify(all));
        await this._wait(700);
        this._check('panel opens with grab', panel.isOpen && Main.modalCount > 0);

        // The three views, switched while open.
        settings.set_string('view', 'timeline');
        await this._wait();
        this._check('timeline: four cards, nothing folded',
            descendants(section(), hasClass('ns-card')).length === 4 &&
            descendants(section(), hasClass('ns-more')).length === 0,
            JSON.stringify(texts(section())));
        this._check('body is plain text', texts(section()).includes('body one'),
            JSON.stringify(texts(section())));
        settings.set_string('view', 'by-app');
        await this._wait();
        const groups = descendants(section(), hasClass('ns-group'));
        this._check('by-app: groups with pill', groups.length === 2 &&
            texts(section()).includes('3 new'), JSON.stringify(texts(section())));
        settings.set_string('view', 'new-then-history');
        await this._wait();
        this._check('new-then-history: three cards', descendants(section(), hasClass('ns-card')).length === 3);

        // "Show 1 more new" by pointer.
        const more = descendants(section(), hasClass('ns-more'))[0];
        await this._click(more);
        this._check('more expands', descendants(section(), hasClass('ns-card')).length === 4 &&
            descendants(section(), hasClass('ns-more')).length === 0 && panel.isOpen);

        // Search. Focus the entry first, as typing would.
        panel._entry.grab_key_focus();
        panel._entry.text = 'twin';
        await this._wait();
        this._check('search filters', descendants(section(), hasClass('ns-row')).length === 2,
            JSON.stringify(texts(section())));
        panel._entry.text = 'zzzz';
        await this._wait();
        this._check('no-match state', texts(section()).includes('Nothing matches'));
        panel._entry.text = '';
        await this._wait();

        // Remove button: hidden until hover, then removes exactly that record
        // without activating the row (activation would close the panel).
        let row = this._rowWithTitle('Twin smoke');
        let remove = descendants(row, hasClass('ns-remove'))[0];
        await this._pointTo(2, 400);
        this._check('remove hidden without hover', remove.opacity === 0 && !remove.reactive);
        await this._moveTo(row);
        this._check('remove shown on hover', remove.opacity === 255 && remove.reactive);
        const before = store.records.length;
        await this._click(remove);
        this._check('remove by pointer', store.records.length === before - 1 && panel.isOpen,
            `records ${before} -> ${store.records.length}, open ${panel.isOpen}`);

        // Action button: runs the action once, does not activate the row.
        // It arrives while open and appears within the background interval.
        const acted = this._notify('Driver action', 'Do it');
        const arrived = await this._waitFor(() => !!this._rowWithTitle('Driver action'), 3000);
        this._check('arrival while open shows within 1 s', arrived >= 0 && arrived <= 1000 + 300,
            `${arrived} ms`);
        // Let it lay out (and any trailing rebuild run) before pointing at it.
        await this._wait(1200);
        row = this._rowWithTitle('Driver action');
        const button = row && descendants(row, hasClass('ns-action'))
            .find(b => b.label === 'Do it');
        this._check('action button shown', !!button, JSON.stringify(texts(section())));
        if (button) {
            await this._click(button);
            this._check('action by pointer', acted.action === 1 && acted.activated === 0 &&
                !panel.isOpen && Main.modalCount === 0,
                `${JSON.stringify(acted)} open ${panel.isOpen} modal ${Main.modalCount}`);
        }
        if (!panel.isOpen) {
            panel.open();
            await this._wait(700);
        }

        // A burst of store events while open: at most one rebuild per second.
        const realRebuild = this._section._rebuild;
        let rebuilds = 0;
        this._section._rebuild = function (...args) {
            rebuilds++;
            return realRebuild.apply(this, args);
        };
        await this._wait(1100);
        for (let i = 0; i < 10; i++) {
            store.update(store.records[0].id, {});
            await this._wait(100);
        }
        await this._wait(1100);
        delete this._section._rebuild;
        this._check('store bursts throttled while open', rebuilds >= 1 && rebuilds <= 3,
            `${rebuilds} rebuilds for 10 events over 1 s`);

        // Keyboard: Tab goes row -> its remove button (shown) -> next row.
        const toActivate = this._notify('Driver activate');
        await this._waitFor(() => !!this._rowWithTitle('Driver activate'), 3000);
        await this._wait(1200);
        const rows = descendants(section(), hasClass('ns-row'))
            .filter(r => r.has_style_class_name('ns-card') || r.has_style_class_name('ns-line'));
        const main0 = descendants(rows[0], hasClass('ns-row-main'))[0];
        const remove0 = descendants(rows[0], hasClass('ns-remove'))[0];
        const main1 = descendants(rows[1], hasClass('ns-row-main'))[0];
        await this._pointTo(2, 400);
        main0.grab_key_focus();
        await this._wait(100);
        this._check('remove shown on row focus', remove0.opacity === 255);
        await this._key(Clutter.KEY_Tab);
        this._check('tab to remove', global.stage.key_focus === remove0 && remove0.opacity === 255);
        await this._key(Clutter.KEY_Tab);
        this._check('tab to next row', global.stage.key_focus === main1);

        // Keyboard remove keeps focus in the panel, so Escape still closes it.
        row = this._rowWithTitle('Gtk smoke');
        remove = descendants(row, hasClass('ns-remove'))[0];
        remove.grab_key_focus();
        await this._wait(100);
        const count = store.records.length;
        await this._key(Clutter.KEY_Return);
        const focus = global.stage.key_focus;
        this._check('remove by keyboard', store.records.length === count - 1 &&
            !store.records.some(r => r.title === 'Gtk smoke'));
        this._check('focus stays in list', !!focus && section().contains(focus));
        await this._key(Clutter.KEY_Escape);
        await this._wait(300);
        this._check('escape closes after keyboard remove', !panel.isOpen && Main.modalCount === 0);
        this._check('expanded reset on close', this._section._expanded.size === 0);
        this._check('rows dropped after close', section().get_n_children() === 0,
            `${section().get_n_children()} children`);

        // Row activation by pointer: activates once, closes the panel, drops the grab.
        panel.open();
        await this._wait(700);
        row = this._rowWithTitle('Driver activate');
        const main = row && descendants(row, hasClass('ns-row-main'))[0];
        this._check('live row present', !!main, JSON.stringify(texts(section())));
        if (main) {
            await this._click(main);
            this._check('activate by pointer', toActivate.activated === 1 && !panel.isOpen &&
                Main.modalCount === 0, `${JSON.stringify(toActivate)} open ${panel.isOpen}`);
        }

        // Clear all.
        panel.open();
        await this._wait(700);
        panel._handlers.onClearAll();
        await this._wait();
        this._check('clear all', store.records.length === 0 && recorder.liveIds().size === 0 &&
            texts(section()).includes('No notifications yet'));
        panel.close();
        await this._wait();
        this._check('rows dropped at end', rowCount() === 0 && section().get_n_children() === 0);
        this._check('closed at end', !panel.isOpen && Main.modalCount === 0);
    }
}
