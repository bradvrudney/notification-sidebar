// Test-only extension, installed by scripts/smoke.sh into its isolated data
// dir. It drives the sidebar of notification-sidebar@bradvrudney.github.io
// with Clutter virtual input devices (real pointer and key events through
// the Shell's picking, gestures and focus manager) and logs one line per
// check: `[ns-smoke-driver] ok <name>` or `[ns-smoke-driver] FAIL <name>`,
// then `[ns-smoke-driver] done`. It reaches into the target's own fields
// (`_panel`, `_section`, ...) because there is no other way in.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const TARGET = 'notification-sidebar@bradvrudney.github.io';
const TAG = '[ns-smoke-driver]';
const SETTLE_MS = 400;
// Served by tests/fake-mpris-player.js, started by scripts/smoke.sh.
const MPRIS_NAME = 'org.mpris.MediaPlayer2.NsSmoke';
const STOCK_TRAY_MODES =
    Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP;

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

    // Super+V, or whatever the default `toggle-message-tray` binding is
    // pressed as: Super held, V pressed and released.
    async _superV() {
        const t = () => GLib.get_monotonic_time();
        this._keyboard.notify_keyval(t(), Clutter.KEY_Super_L, Clutter.KeyState.PRESSED);
        await this._wait(30);
        this._keyboard.notify_keyval(t(), Clutter.KEY_v, Clutter.KeyState.PRESSED);
        await this._wait(30);
        this._keyboard.notify_keyval(t(), Clutter.KEY_v, Clutter.KeyState.RELEASED);
        await this._wait(30);
        this._keyboard.notify_keyval(t(), Clutter.KEY_Super_L, Clutter.KeyState.RELEASED);
        await this._wait();
    }

    _notify(title, actionLabel = null, urgency = null) {
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
        if (urgency !== null)
            n.urgency = urgency;
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

        // The media section, while the fake player runs. Checked first and
        // the player quit at the end, so the notification checks below see
        // the same layout as before.
        await this._mediaChecks(ext, panel);

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

        await this._takeoverChecks(ext);
    }

    async _mediaChecks(ext, panel) {
        const media = ext._media;
        this._check('media section exists', !!media);
        if (!media)
            return;
        const shown = await this._waitFor(
            () => media.actor.visible && media.actor.get_n_children() === 1, 5000);
        this._check('media section shows the player',
            shown >= 0 && texts(media.actor).includes('Smoke track'),
            JSON.stringify(texts(media.actor)));
        if (shown < 0)
            return;
        await this._wait();
        const kids = panel._host.get_children();
        this._check('media section above notifications',
            kids.indexOf(media.actor) === 0 && kids.indexOf(this._section.actor) === 1,
            `media at ${kids.indexOf(media.actor)}, notifications at ${kids.indexOf(this._section.actor)}`);

        const message = media.actor.get_first_child();
        const [mx] = message.get_transformed_position();
        const [px] = panel._actor.get_transformed_position();
        const [minWidth] = message.get_preferred_width(-1);
        this._check('media message fits the panel',
            message.width > 0 && minWidth <= message.width &&
            mx + message.width <= px + panel._actor.width,
            `x ${mx} w ${message.width} min ${minWidth}, panel x ${px} w ${panel._actor.width}`);

        const controls = descendants(message, hasClass('message-media-control'));
        const play = controls[1];
        const icon = () => play?.child?.icon_name;
        this._check('media controls shown', controls.length === 3 &&
            icon() === 'media-playback-start-symbolic', `${controls.length} ${icon()}`);
        if (play) {
            await this._click(play);
            const flipped = await this._waitFor(
                () => icon() === 'media-playback-pause-symbolic', 3000);
            this._check('play/pause by pointer inside the grab',
                flipped >= 0 && panel.isOpen && Main.modalCount > 0,
                `${icon()} open ${panel.isOpen} modal ${Main.modalCount}`);
        }

        // Clicking the message raises the player (a no-op here) and closes
        // the panel, as activating a notification row does. Closing marks
        // everything seen, which the notification checks after this rely
        // on not happening yet: hold it off for this one close.
        const store = ext._store;
        store.markSeen = () => {};
        await this._click(message.titleLabel);
        delete store.markSeen;
        this._check('media message click closes the panel', !panel.isOpen && Main.modalCount === 0,
            `open ${panel.isOpen} modal ${Main.modalCount}`);
        if (!panel.isOpen) {
            panel.open();
            await this._wait(700);
        }

        Gio.DBus.session.call(MPRIS_NAME, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2',
            'Quit', null, null, Gio.DBusCallFlags.NONE, -1, null, null);
        const gone = await this._waitFor(
            () => !media.actor.visible && media.actor.get_n_children() === 0, 5000);
        this._check('media section hides when the player quits', gone >= 0,
            `visible ${media.actor.visible}, ${media.actor.get_n_children()} children`);
    }

    // The clock menu and Super+V, taken over while enabled and stock after
    // disable, over two disable/enable cycles. The target's disable() and
    // enable() are called directly: going through the extension manager
    // would disable and re-enable this driver too (it is enabled later).
    async _takeoverChecks(ext) {
        const dm = Main.panel.statusArea.dateMenu;
        for (let cycle = 1; cycle <= 2; cycle++) {
            // eslint-disable-next-line no-await-in-loop
            await this._postUnseen(dm, `cycle ${cycle}`);
            // eslint-disable-next-line no-await-in-loop
            await this._expectTakenOver(ext, dm, `cycle ${cycle} enabled`);
            ext.disable();
            // eslint-disable-next-line no-await-in-loop
            await this._wait();
            // eslint-disable-next-line no-await-in-loop
            await this._expectStock(dm, `cycle ${cycle} disabled`);
            ext.enable();
            // eslint-disable-next-line no-await-in-loop
            await this._wait(1000);
        }
        await this._postUnseen(dm, 'after cycles');
        await this._expectTakenOver(ext, dm, 'after cycles');

        // The Shell resets the list's visibility on every session update.
        Main.sessionMode.emit('updated');
        await this._wait();
        this._check('list stays hidden after a session update', !dm._messageList.visible);
        this._check('takeover checks finished', true);
    }

    // A low-urgency notification gets no banner, so it stays unseen and the
    // stock dot has something to show. Opening the stock clock menu marks
    // everything seen, so each cycle posts a new one.
    async _postUnseen(dm, label) {
        this._notify(`Driver dot ${label}`, null, MessageTray.Urgency.LOW);
        const counted = await this._waitFor(() => dm._indicator._count > 0, 3000);
        this._check(`${label}: unseen notification for the dot`, counted >= 0,
            `${dm._indicator._count}`);
    }

    async _expectTakenOver(ext, dm, label) {
        this._check(`${label}: clock list hidden`, !dm._messageList.visible);
        this._check(`${label}: clock dot hidden`, !dm._indicator.visible && dm._indicator._count > 0,
            `visible ${dm._indicator.visible} count ${dm._indicator._count}`);
        this._check(`${label}: keybinding modes`,
            Main.wm._allowedKeybindings['toggle-message-tray'] === STOCK_TRAY_MODES);
        const panel = ext._panel;
        if (!panel) {
            this._check(`${label}: panel built`, false);
            return;
        }
        await this._superV();
        this._check(`${label}: super+v opens the sidebar`,
            panel.isOpen && !dm.menu.isOpen && Main.modalCount > 0,
            `open ${panel.isOpen} clock ${dm.menu.isOpen} modal ${Main.modalCount}`);
        await this._wait(300);
        await this._superV();
        this._check(`${label}: super+v closes the open sidebar`,
            !panel.isOpen && Main.modalCount === 0,
            `open ${panel.isOpen} modal ${Main.modalCount}`);
    }

    async _expectStock(dm, label) {
        const stockList = Main.sessionMode.hasNotifications && !Main.sessionMode.isGreeter;
        this._check(`${label}: clock list back to stock`,
            stockList && dm._messageList.visible === stockList, `${dm._messageList.visible}`);
        const banners = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'})
            .get_boolean('show-banners');
        this._check(`${label}: clock dot back`,
            banners && dm._indicator._count > 0 && dm._indicator.visible,
            `banners ${banners} count ${dm._indicator._count} visible ${dm._indicator.visible}`);
        this._check(`${label}: keybinding modes`,
            Main.wm._allowedKeybindings['toggle-message-tray'] === STOCK_TRAY_MODES);
        await this._superV();
        this._check(`${label}: stock super+v opens the clock menu`, dm.menu.isOpen);
        await this._superV();
        this._check(`${label}: stock super+v closes the clock menu`,
            !dm.menu.isOpen && Main.modalCount === 0, `open ${dm.menu.isOpen} modal ${Main.modalCount}`);
    }
}
