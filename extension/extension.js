import GLib from 'gi://GLib';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {HistoryStore} from './lib/core/store.js';
import {
    loadHistory, saveHistory, quarantineHistory, DebouncedSaver, historyPath,
} from './lib/core/historyFile.js';
import {Recorder} from './lib/recorder.js';
import {Indicator} from './lib/indicator.js';
import {SidebarPanel} from './lib/panel.js';
import {NotificationSection} from './lib/notificationSection.js';
import {MediaSection} from './lib/mediaSection.js';
import {ShellTakeover} from './lib/shellTakeover.js';

const PRUNE_INTERVAL_SECONDS = 3600;

function readFile(path) {
    try {
        const [ok, bytes] = GLib.file_get_contents(path);
        return ok ? new TextDecoder().decode(bytes).trim() : '';
    } catch (e) {
        return '';
    }
}

export function currentSessionId() {
    const bootId = readFile('/proc/sys/kernel/random/boot_id');
    return `${bootId}:${GLib.getenv('XDG_SESSION_ID') ?? ''}`;
}

export default class NotificationSidebarExtension extends Extension {
    enable() {
        try {
            this._enable();
        } catch (e) {
            this.disable();
            throw e;
        }
    }

    _enable() {
        const path = historyPath();
        const now = () => Math.floor(Date.now() / 1000);
        this._settings = this.getSettings();
        const opts = {now, retentionDays: this._settings.get_int('retention-days')};

        const {data, quarantined} = loadHistory(path);
        if (quarantined)
            console.error(`notification-sidebar: moved unreadable history to ${quarantined}`);
        let store = null;
        if (data) {
            try {
                store = HistoryStore.fromJSON(data, opts);
            } catch (e) {
                console.error(`notification-sidebar: unusable history ${path}: ${e.message}`);
                const moved = quarantineHistory(path);
                if (moved)
                    console.error(`notification-sidebar: moved unusable history to ${moved}`);
            }
        }
        this._store = store ?? new HistoryStore(opts);
        this._store.prune();

        this._saver = new DebouncedSaver(() => saveHistory(path, this._store.toJSON()));
        this._unsubscribeSaver = this._store.subscribe(() => this._saver.schedule());

        this._retentionId = this._settings.connect('changed::retention-days', () => {
            try {
                this._store.setRetentionDays(this._settings.get_int('retention-days'));
            } catch (e) {
                console.error(e);
            }
        });

        this._now = now;
        this._sessionId = currentSessionId();
        this._recorder = new Recorder({store: this._store, sessionId: this._sessionId});
        this._recorder.enable();

        this._pruneTimer = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, PRUNE_INTERVAL_SECONDS, () => {
                try {
                    this._store.prune();
                } catch (e) {
                    console.error(e);
                }
                return GLib.SOURCE_CONTINUE;
            });

        this._sessionModeId = Main.sessionMode.connect('updated', () => {
            try {
                this._saver?.flush();
                this._syncUi();
            } catch (e) {
                console.error(e);
            }
        });
        this._syncUi();
        console.log('[notification-sidebar] enabled');
    }

    // The bell, panel and takeover exist only in the `user` session mode. A
    // UI failure is logged and cleaned up; it never stops the recorder.
    _syncUi() {
        if (Main.sessionMode.currentMode === 'user')
            this._buildUi();
        else
            this._destroyUi();
    }

    _buildUi() {
        if (this._indicator || this._panel || this._section || this._media)
            return;
        try {
            const store = this._store;
            const recorder = this._recorder;
            this._section = new NotificationSection({
                store,
                recorder,
                settings: this._settings,
                sessionId: this._sessionId,
                now: this._now,
                closePanel: () => this._panel?.close(),
            });
            const section = this._section;
            this._panel = new SidebarPanel({
                settings: this._settings,
                onOpened: () => section.setOpen(true),
                onClosed: () => {
                    section.resetExpanded();
                    section.setOpen(false);
                    store.markSeen();
                },
            });
            this._panel.addSection({id: 'notifications', order: 10, actor: section.actor});
            this._media = new MediaSection({closePanel: () => this._panel?.close()});
            this._panel.addSection({id: 'media', order: 0, actor: this._media.actor});
            this._unsubscribeSearch = this._panel.onSearchChanged(text => section.setQuery(text));
            this._panel.setMenuHandlers({
                onViewChosen: view => this._settings.set_string('view', view),
                onClearAll: () => {
                    for (const id of recorder.liveIds()) {
                        try {
                            recorder.dismiss(id);
                        } catch (e) {
                            console.error(e);
                        }
                    }
                    store.clear();
                    section.refresh();
                },
                onOpenSettings: () => {
                    this._panel?.close();
                    this.openPreferences();
                },
            });
            this._indicator = new Indicator({onToggle: () => this._panel?.toggle()});
            Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
            this._unsubscribeUi = store.subscribe(() => this._refreshCount());
            this._refreshCount();
            console.log('[notification-sidebar] interface built');
        } catch (e) {
            console.error(`notification-sidebar: could not build the interface: ${e.message}`);
            console.error(e);
            this._destroyUi();
            return;
        }
        this._enableTakeover();
    }

    // Last step of building the interface, only once all of it exists. On
    // failure the Shell is left stock (ShellTakeover undoes a partial
    // enable) and the sidebar keeps working from the bell.
    _enableTakeover() {
        try {
            this._takeover = new ShellTakeover({onToggle: () => this._toggleFromShortcut()});
            this._takeover.enable();
            const takeover = this._takeover;
            this._panel.setToggleKey(event => takeover.isToggleEvent(event));
        } catch (e) {
            console.error(`notification-sidebar: could not take over the clock menu: ${e.message}`);
            console.error(e);
            try {
                this._takeover?.disable();
            } catch (e2) {
                console.error(e2);
            }
            this._takeover = null;
        }
    }

    // Like the stock shortcut, which switches from any open top-bar menu to
    // the clock menu: close that menu (and its grab) before opening.
    _toggleFromShortcut() {
        const panel = this._panel;
        if (!panel)
            return;
        if (!panel.isOpen)
            Main.panel.menuManager.activeMenu?.close();
        panel.toggle();
    }

    _refreshCount() {
        const n = this._store.newCount();
        this._indicator?.setCount(n);
        this._panel?.setNewCount(n);
    }

    // Safe when nothing was built. Each step is isolated so one failure
    // cannot leave the others behind (in particular the modal grab). The
    // takeover goes first, so the Shell's own list and shortcut are back
    // before anything else is torn down. The panel goes before the sections:
    // closing it calls into the notification section and it holds both
    // sections' actors.
    _destroyUi() {
        const steps = [
            () => this._takeover?.disable(),
            () => this._unsubscribeUi?.(),
            () => this._unsubscribeSearch?.(),
            () => this._panel?.destroy(),
            () => this._media?.destroy(),
            () => this._section?.destroy(),
            () => this._indicator?.destroy(),
        ];
        for (const step of steps) {
            try {
                step();
            } catch (e) {
                console.error(e);
            }
        }
        this._takeover = null;
        this._unsubscribeUi = null;
        this._unsubscribeSearch = null;
        this._panel = null;
        this._media = null;
        this._section = null;
        this._indicator = null;
    }

    disable() {
        this._destroyUi();
        if (this._sessionModeId) {
            Main.sessionMode.disconnect(this._sessionModeId);
            this._sessionModeId = null;
        }
        if (this._pruneTimer) {
            GLib.source_remove(this._pruneTimer);
            this._pruneTimer = null;
        }
        this._recorder?.disable();
        this._recorder = null;
        if (this._retentionId) {
            this._settings?.disconnect(this._retentionId);
            this._retentionId = null;
        }
        this._settings = null;
        this._unsubscribeSaver?.();
        this._unsubscribeSaver = null;
        this._saver?.destroy();
        this._saver = null;
        this._store = null;
        this._now = null;
        this._sessionId = null;
        console.log('[notification-sidebar] disabled');
    }
}
