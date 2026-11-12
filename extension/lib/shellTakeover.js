// The only file allowed to touch private members of Shell objects. While
// enabled it hides the clock menu's notification list and its unseen dot, and
// points the `toggle-message-tray` shortcut (Super+V) at the sidebar.
// `disable()` puts all of it back as the Shell itself sets it up.
//
// Checked against GNOME Shell 51 (ui/dateMenu.js, ui/windowManager.js):
// - `dateMenu._messageList` is a `Calendar.CalendarMessageList`; the Shell
//   sets its `visible` in `DateMenuButton._sessionUpdated()`, run on every
//   `Main.sessionMode` `updated`.
// - `dateMenu._indicator` is a `MessagesIndicator` (an St.Icon) whose
//   `visible` is written by its own `_sync()`, called from message-tray and
//   settings signals. It keeps its count while hidden; `_updateCount()`
//   recomputes it and calls `_sync()`.
// - The stock binding is registered in `WindowManager._init()` with the same
//   settings, flags and modes used here, and a handler that calls
//   `Main.panel.toggleCalendar()`.
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const KEYBINDING = 'toggle-message-tray';
const KEYBINDINGS_SCHEMA = 'org.gnome.shell.keybindings';
const KEYBINDING_FLAGS = Meta.KeyBindingFlags.IGNORE_AUTOREPEAT;
const KEYBINDING_MODES =
    Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW | Shell.ActionMode.POPUP;

function stockListVisible() {
    return Main.sessionMode.hasNotifications && !Main.sessionMode.isGreeter;
}

export class ShellTakeover {
    constructor({onToggle}) {
        this._onToggle = onToggle;
        this._dateMenu = null;
        this._indicatorId = 0;
        this._sessionId = 0;
        this._stockRemoved = false;
        this._action = Meta.KeyBindingAction.NONE;
    }

    // If any part fails, what was already applied is undone and the error
    // is rethrown: the Shell is left stock.
    enable() {
        try {
            this._takeClockMenu();
            this._takeKeybinding();
        } catch (e) {
            this.disable();
            throw e;
        }
    }

    // Safe when enable() never ran or only partly ran; idempotent. Each
    // restore step is isolated so one failure cannot leave the other behind.
    disable() {
        for (const step of [() => this._restoreKeybinding(), () => this._restoreClockMenu()]) {
            try {
                step();
            } catch (e) {
                console.error(e);
            }
        }
    }

    // True when `event` is a key press of the toggle shortcut as it is bound
    // now (read through mutter, so a remapped or second accelerator counts).
    // Used by the sidebar while its modal grab is up: the grab's action mode
    // is NONE, so the Shell does not run the keybinding then.
    isToggleEvent(event) {
        if (this._action === Meta.KeyBindingAction.NONE)
            return false;
        const action = global.display.get_keybinding_action(
            event.get_key_code(), event.get_state());
        return action === this._action;
    }

    _takeClockMenu() {
        const dm = Main.panel.statusArea.dateMenu;
        const list = dm?._messageList;
        const indicator = dm?._indicator;
        if (!list || !indicator) {
            console.warn('notification-sidebar: the clock menu is not laid out as expected; ' +
                'leaving its notification list alone');
            return;
        }
        this._dateMenu = dm;

        // Disconnected in _restoreClockMenu().
        this._indicatorId = indicator.connect('notify::visible', () => {
            if (indicator.visible)
                indicator.visible = false;
        });
        indicator.visible = false;

        // Runs after the Shell's own handler (connected at startup), which
        // sets the list visible again. Disconnected in _restoreClockMenu().
        this._sessionId = Main.sessionMode.connect('updated', () => {
            try {
                list.visible = false;
            } catch (e) {
                console.error(e);
            }
        });
        list.visible = false;
    }

    _restoreClockMenu() {
        const dm = this._dateMenu;
        this._dateMenu = null;
        if (this._sessionId) {
            Main.sessionMode.disconnect(this._sessionId);
            this._sessionId = 0;
        }
        if (!dm)
            return;

        const indicator = dm._indicator;
        if (this._indicatorId) {
            indicator.disconnect(this._indicatorId);
            this._indicatorId = 0;
        }
        // The Shell's own rule from DateMenuButton._sessionUpdated().
        dm._messageList.visible = stockListVisible();
        // Let the indicator decide again from its (still current) sources.
        if (typeof indicator._updateCount === 'function') {
            indicator._updateCount();
        } else {
            console.warn('notification-sidebar: cannot recompute the clock dot; ' +
                'it shows again on the next notification');
        }
    }

    _takeKeybinding() {
        Main.wm.removeKeybinding(KEYBINDING);
        this._stockRemoved = true;
        const action = Main.wm.addKeybinding(KEYBINDING,
            new Gio.Settings({schema_id: KEYBINDINGS_SCHEMA}),
            KEYBINDING_FLAGS, KEYBINDING_MODES,
            () => {
                try {
                    this._onToggle();
                } catch (e) {
                    console.error(e);
                }
            });
        if (action === Meta.KeyBindingAction.NONE)
            throw new Error(`notification-sidebar: could not bind ${KEYBINDING}`);
        this._action = action;
    }

    _restoreKeybinding() {
        if (this._action !== Meta.KeyBindingAction.NONE) {
            this._action = Meta.KeyBindingAction.NONE;
            Main.wm.removeKeybinding(KEYBINDING);
        }
        if (this._stockRemoved) {
            this._stockRemoved = false;
            Main.wm.addKeybinding(KEYBINDING,
                new Gio.Settings({schema_id: KEYBINDINGS_SCHEMA}),
                KEYBINDING_FLAGS, KEYBINDING_MODES,
                () => Main.panel.toggleCalendar());
        }
    }
}
