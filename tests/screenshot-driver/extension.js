// Test-only extension, installed by scripts/screenshots.sh into its isolated
// data dir. It fills notification-sidebar@bradvrudney.github.io with sample
// entries and saves the README screenshots into $NS_SHOT_OUT. It reaches into
// the target's own fields (`_panel`, `_store`, ...) because there is no other
// way in. Ends with `[ns-screenshot-driver] done` or `... FAIL <why>`.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

const TARGET = 'notification-sidebar@bradvrudney.github.io';
const TAG = '[ns-screenshot-driver]';
const MARKER = 'ns-screenshot-driver-marker';
const MIN = 60;
const HOUR = 3600;
const PAD = 12;

// [app name, icon, title, body, seconds ago, previous session?]
const SAMPLES = [
    ['Terminal', 'org.gnome.Ptyxis', 'Command completed', 'make test passed in 42 seconds', 4 * MIN],
    ['Files', 'org.gnome.Nautilus', 'Copy finished', '214 files copied to Backup', 19 * MIN],
    ['Clocks', 'org.gnome.clocks', 'Timer finished', 'Tea', 33 * MIN],
    ['Disks', 'org.gnome.DiskUtility', 'Backup drive is almost full', '4.1 GB free of 500 GB', 2 * HOUR],
    ['Calendar', 'org.gnome.Calendar', 'Lunch with Priya', 'Starts at 12:30 at the usual place', 3 * HOUR],
    ['Software', 'org.gnome.Software', 'Text Editor was updated', 'Version 51.1 is now installed', 5 * HOUR],
    ['Files', 'org.gnome.Nautilus', 'Trash emptied', '38 items removed', 6 * HOUR],
    ['Settings', 'org.gnome.Settings', 'Printer added', 'Office LaserJet is ready to print', 25 * HOUR, true],
    ['Weather', 'org.gnome.Weather', 'Rain from 16:00', 'Light rain through the evening, 9 °C', 28 * HOUR, true],
    ['Terminal', 'org.gnome.Ptyxis', 'Command completed', 'dnf upgrade finished: 63 packages', 31 * HOUR, true],
    ['Calendar', 'org.gnome.Calendar', 'Dentist tomorrow', '09:15, bring the referral letter', 52 * HOUR, true],
    ['Software', 'org.gnome.Software', 'Fedora 45 updates installed', 'Restart was completed', 75 * HOUR, true],
];

// [app name, icon, title, body, action labels]: real notifications, so their
// buttons are drawn.
const LIVE = [
    ['Software', 'org.gnome.Software', 'Updates ready to install', '12 updates, one security fix', ['Restart and install', 'Not now']],
    ['Calendar', 'org.gnome.Calendar', 'Design review in 15 minutes', 'Room 2, with the platform team', ['Join call', 'Snooze']],
];

function inScreenshotSession() {
    return GLib.getenv('NS_SHOT_INNER') === '1' && !!GLib.getenv('NS_SHOT_OUT') &&
        GLib.file_test(GLib.build_filenamev([GLib.get_user_data_dir(), MARKER]),
            GLib.FileTest.EXISTS);
}

export default class ScreenshotDriver extends Extension {
    enable() {
        this._timers = new Set();
        this._sources = [];
        this._cancelled = false;
        if (!inScreenshotSession()) {
            console.log(`${TAG} not a screenshot session (no marker); doing nothing`);
            return;
        }
        this._run()
            .then(() => console.log(`${TAG} done`))
            .catch(e => console.log(`${TAG} FAIL ${e.message}\n${e.stack}`));
    }

    disable() {
        this._cancelled = true;
        if (this._blockedBanners)
            Main.messageTray.bannerBlocked = false;
        this._blockedBanners = false;
        for (const id of this._timers)
            GLib.source_remove(id);
        this._timers.clear();
        for (const source of this._sources)
            source.destroy();
        this._sources = [];
    }

    _wait(ms = 400) {
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

    _notify([appName, iconName, title, body, actions]) {
        const source = new MessageTray.Source({title: appName, iconName});
        source.connect('destroy', () => {
            this._sources = this._sources.filter(s => s !== source);
        });
        Main.messageTray.add(source);
        this._sources.push(source);
        const n = new MessageTray.Notification({source, title, body});
        for (const label of actions)
            n.addAction(label, () => {});
        source.addNotification(n);
    }

    // `area` is [x, y, width, height], or null for the whole screen.
    _shoot(name, area = null) {
        const path = GLib.build_filenamev([GLib.getenv('NS_SHOT_OUT'), `${name}.png`]);
        const stream = Gio.File.new_for_path(path)
            .replace(null, false, Gio.FileCreateFlags.NONE, null);
        const shooter = new Shell.Screenshot();
        return new Promise((resolve, reject) => {
            const finish = method => (obj, res) => {
                try {
                    obj[method](res);
                    stream.close(null);
                    console.log(`${TAG} saved ${name}.png`);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };
            if (area)
                shooter.screenshot_area(...area, stream, finish('screenshot_area_finish'));
            else
                shooter.screenshot(false, stream, finish('screenshot_finish'));
        });
    }

    async _run() {
        const ext = Main.extensionManager.lookup(TARGET)?.stateObj;
        if (!ext?._panel || !ext._store)
            throw new Error('target extension or its interface is missing');
        const {_panel: panel, _store: store, _settings: settings} = ext;

        // A fresh Shell starts in the overview with its welcome dialog up.
        for (const dialog of Main.layoutManager.modalDialogGroup.get_children())
            dialog.close?.();
        Main.overview.hide();
        await this._wait(1500);

        const now = Math.floor(Date.now() / 1000);
        SAMPLES.forEach(([appName, icon, title, body, ago, previous], i) => store.add({
            id: `sample-${i}`,
            sessionId: previous ? 'an-earlier-session' : ext._sessionId,
            appId: null, appName, icon, title, body,
            time: now - ago,
            urgency: 1,
        }));
        store.lastSeen = now - 45 * MIN;
        // No banners over the screenshots.
        Main.messageTray.bannerBlocked = true;
        this._blockedBanners = true;
        LIVE.forEach(live => this._notify(live));
        await this._wait(1000);

        settings.set_string('view', 'new-then-history');
        panel.open();
        await this._wait(1200);
        await this._shoot('desktop');

        const [x, y] = panel._actor.get_transformed_position();
        const [w, h] = panel._actor.get_transformed_size();
        const area = [Math.max(0, Math.floor(x - PAD)), Math.max(0, Math.floor(y - PAD)),
            Math.ceil(w + PAD * 2), Math.ceil(h + PAD * 2)];
        area[2] = Math.min(area[2], global.stage.width - area[0]);
        area[3] = Math.min(area[3], global.stage.height - area[1]);
        for (const view of ['new-then-history', 'timeline', 'by-app']) {
            settings.set_string('view', view);
            await this._wait(1500);
            await this._shoot(`view-${view}`, area);
        }
        panel.close({animate: false});
        await this._wait();
    }
}
