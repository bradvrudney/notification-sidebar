import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {panelGeometry, LookTracker, MARGIN} from './core/dock.js';

const ANIMATION_MS = 200;

// Events that show the pointer is in use over the panel.
const POINTER_ACTIVITY = new Set([
    Clutter.EventType.MOTION,
    Clutter.EventType.SCROLL,
    Clutter.EventType.BUTTON_PRESS,
    Clutter.EventType.TOUCH_BEGIN,
    Clutter.EventType.TOUCH_UPDATE,
]);

const VIEWS = [
    ['timeline', 'Timeline'],
    ['by-app', 'By app'],
    ['new-then-history', 'New, then history'],
];

function guarded(fn) {
    try {
        fn?.();
    } catch (e) {
        console.error(e);
    }
}

// The panel has two ways of being open. Unpinned it is a popup: it holds a
// modal grab and closes on Escape, a press outside it or the toggle shortcut.
// Pinned (the `pinned` setting) it is docked: no grab, it stays up, and an
// invisible strip along the right edge of the primary monitor is registered
// with the Shell as a strut so windows keep clear of it. A docked panel is
// hidden, not closed, while the overview is up or a window is fullscreen on
// its monitor.
export class SidebarPanel {
    /**
     * `onClosed({seen, byUser})`: `byUser` is false when the panel went away
     * because it was destroyed; `seen` is false when that happened to a
     * docked panel, which nobody need have been looking at.
     * `onSeen()` is called when a docked panel has been looked at.
     */
    constructor({settings, onOpened, onClosed, onSeen}) {
        this._settings = settings;
        this._onOpened = onOpened;
        this._onClosed = onClosed;
        this._onSeen = onSeen;
        this._open = false;
        this._shown = false;
        this._docked = false;
        this._pinned = settings.get_boolean('pinned');
        this._look = new LookTracker();
        this._strutTracked = false;
        this._grab = null;
        this._sections = new Map();
        this._searchListeners = new Set();
        this._handlers = {};
        this._settingsIds = [];
        this._isToggleKey = null;
        this._destroyed = false;

        this._actor = new St.BoxLayout({
            style_class: 'ns-panel',
            orientation: Clutter.Orientation.VERTICAL,
            reactive: true,
            track_hover: true,
            visible: false,
        });
        // Never painted and never picked: it only gives the Shell a box on
        // the screen edge to make a strut from. Tracked while docked.
        this._strut = new Clutter.Actor();
        this._actor.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                if (this._docked)
                    this._leaveKeyboard();
                else
                    this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._actor.connect('notify::hover', () => this._onHover());
        // The modal grab routes every event through the grab actor, so a press
        // outside the panel shows up here. Docked there is no grab: only
        // events for the panel itself arrive, and none of them closes it.
        this._actor.connect('captured-event', (_a, event) => {
            const type = event.type();
            if (this._docked && POINTER_ACTIVITY.has(type))
                this._look.activity(GLib.get_monotonic_time() / 1000);
            if (!this._grab)
                return Clutter.EVENT_PROPAGATE;
            // The Shell runs no keybinding under this grab (action mode
            // NONE), so the toggle shortcut is matched here to close.
            if (this._open && type === Clutter.EventType.KEY_PRESS &&
                !(event.get_flags() & Clutter.EventFlags.FLAG_REPEATED) &&
                this._matchesToggleKey(event)) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            if (this._open &&
                (type === Clutter.EventType.BUTTON_PRESS || type === Clutter.EventType.TOUCH_BEGIN)) {
                const target = global.stage.get_event_actor(event);
                // The popup menu is a separate actor stacked above the panel.
                const inside = target &&
                    (this._actor.contains(target) || this._menu?.actor.contains(target));
                if (!inside && !this._menu?.isOpen) {
                    this.close();
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._buildHeader();
        this._buildSearch();
        this._buildBody();
        this._buildFooter();

        Main.layoutManager.addTopChrome(this._actor);
        // Makes the panel a focus group, so Tab / Shift+Tab move between the
        // search entry, the header buttons, the rows and the Do Not Disturb
        // row, and lists it in the Ctrl+Alt+Tab switcher while it is on
        // screen: the keyboard's way into a docked panel.
        Main.ctrlAltTabManager.addGroup(this._actor, 'Notifications',
            'preferences-system-notifications-symbolic');
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._reposition());
        this._topBar = Main.layoutManager.panelBox;
        this._topBarId = this._topBar.connect('notify::height', () => this._reposition());
        this._themeContext = St.ThemeContext.get_for_stage(global.stage);
        this._scaleId = this._themeContext.connect('notify::scale-factor', () => this._reposition());
        const syncShown = () => this._syncShown();
        this._overviewIds = ['showing', 'hiding', 'hidden']
            .map(signal => Main.overview.connect(signal, syncShown));
        this._fullscreenId = global.display.connect('in-fullscreen-changed', syncShown);
        this._reposition();

        // Created after the actor so the popup is stacked above the panel.
        this._buildMenu();

        this._settingsIds.push(
            this._settings.connect('changed::show-search', () => this._syncSearchVisible()),
            this._settings.connect('changed::view', () => this._syncViewOrnaments()),
            this._settings.connect('changed::pinned',
                () => this._applyPinned(this._settings.get_boolean('pinned'))));
        this._syncSearchVisible();
        this._syncViewOrnaments();
        this._pin.checked = this._pinned;
    }

    get isOpen() {
        return this._open;
    }

    // Open and docked, whether or not the overview or a fullscreen window
    // is hiding it just now.
    get isDocked() {
        return this._docked;
    }

    get searchText() {
        return this._entry.text;
    }

    onSearchChanged(fn) {
        this._searchListeners.add(fn);
        return () => this._searchListeners.delete(fn);
    }

    setNewCount(n) {
        this._count.visible = n > 0;
        this._count.text = `${n} new`;
    }

    // `isToggleKey(event)` tells whether a key press is the shortcut that
    // toggles the panel; null when there is none.
    setToggleKey(isToggleKey) {
        this._isToggleKey = isToggleKey;
    }

    _matchesToggleKey(event) {
        try {
            return !!this._isToggleKey?.(event);
        } catch (e) {
            console.error(e);
            return false;
        }
    }

    setMenuHandlers({onViewChosen, onClearAll, onOpenSettings}) {
        this._handlers = {onViewChosen, onClearAll, onOpenSettings};
    }

    addSection({id, order, actor}) {
        this.removeSection(id);
        this._sections.set(id, {order, actor});
        this._layoutSections();
    }

    removeSection(id) {
        const section = this._sections.get(id);
        if (!section)
            return;
        this._sections.delete(id);
        if (section.actor.get_parent() === this._host)
            this._host.remove_child(section.actor);
    }

    open() {
        if (this._open || this._destroyed)
            return;
        this._reposition();
        if (this._pinned)
            this._dock();
        else
            this._grabInput();
        this._open = true;

        guarded(() => this._onOpened?.());

        this._setShown(!this._suppressed(), 'slide');
    }

    close({animate = true, teardown = false} = {}) {
        if (!this._open)
            return;
        this._open = false;
        const wasDocked = this._docked;

        guarded(() => this._menu?.close({animate: false}));
        this._releaseGrab();
        if (wasDocked)
            guarded(() => this._undock());
        this._entry.text = '';
        this._look.reset();

        this._setShown(false, 'slide', animate);

        guarded(() => this._onClosed?.({seen: !(teardown && wasDocked), byUser: !teardown}));
    }

    toggle() {
        if (this._open)
            this.close();
        else
            this.open();
    }

    // The user acted on something in the panel (activated a row, ran an
    // action, opened settings). A popup closes, so the window that comes up
    // is not behind a modal panel; a docked panel is in nobody's way.
    dismiss() {
        if (!this._docked)
            this.close();
    }

    destroy() {
        if (this._destroyed)
            return;
        try {
            this.close({animate: false, teardown: true});
        } finally {
            this._destroyed = true;
            this._teardown();
        }
    }

    // `pinned` is the mode from now on. An open panel changes over at once;
    // pinning opens a closed one. Unpinning from the panel's own button
    // (`fromPanel`) leaves it up as a popup; unpinning from anywhere else
    // closes it, since a popup would take the pointer and keyboard away from
    // whatever the user is in.
    _applyPinned(pinned, {fromPanel = false} = {}) {
        if (this._destroyed)
            return;
        this._pinned = pinned;
        this._pin.checked = pinned;
        if (pinned) {
            if (this._open)
                this._setDocked(true);
            else
                this.open();
        } else if (this._docked) {
            if (fromPanel)
                this._setDocked(false);
            else
                this.close();
        }
    }

    _setDocked(docked) {
        if (!this._open || this._docked === docked)
            return;
        if (docked) {
            this._releaseGrab();
            this._dock();
        } else {
            this._undock();
            this._grabInput();
        }
        this._syncShown();
    }

    _grabInput() {
        // Above everything, popups included.
        Main.uiGroup.set_child_above_sibling(this._actor, null);
        this._grab = Main.pushModal(this._actor);
    }

    _releaseGrab() {
        if (!this._grab)
            return;
        const grab = this._grab;
        this._grab = null;
        try {
            Main.popModal(grab);
        } catch (e) {
            console.error(e);
        }
    }

    _dock() {
        this._docked = true;
        // With the rest of the Shell's own chrome: under popups, system
        // dialogs and the screenshot interface rather than over them.
        Main.uiGroup.set_child_below_sibling(this._actor, global.top_window_group);
        // If the strut cannot be set up the panel still docks; it then
        // overlaps windows instead of keeping them clear.
        guarded(() => this._trackStrut());
    }

    _trackStrut() {
        if (this._strutTracked)
            return;
        Main.layoutManager.addChrome(this._strut, {affectsStruts: true});
        this._strutTracked = true;
        this._strut.show();
    }

    _undock() {
        this._docked = false;
        this._untrackStrut();
        Main.uiGroup.set_child_above_sibling(this._actor, null);
    }

    // The Shell keeps a strut for as long as its actor is tracked, visible
    // or not, so the actor is taken out of the chrome altogether.
    _untrackStrut() {
        if (!this._strutTracked)
            return;
        this._strutTracked = false;
        Main.layoutManager.removeChrome(this._strut);
    }

    // A docked panel gives way to the overview, which is laid out across
    // the whole monitor, and to a fullscreen window on its monitor. The
    // strut stays, so windows do not move.
    _suppressed() {
        return this._docked && (Main.overview.visibleTarget ||
            !!Main.layoutManager.primaryMonitor?.inFullscreen);
    }

    _syncShown() {
        if (this._open && !this._destroyed)
            this._setShown(!this._suppressed(), 'fade');
    }

    // Puts the panel on or off the screen, sliding from the edge or fading.
    _setShown(show, how, animate = true) {
        if (show === this._shown)
            return;
        this._shown = show;
        const actor = this._actor;
        const animated = animate && St.Settings.get().enable_animations;
        actor.remove_all_transitions();
        if (show) {
            actor.visible = true;
            if (!animated) {
                actor.translation_x = 0;
                actor.opacity = 255;
                return;
            }
            if (how === 'slide') {
                actor.opacity = 255;
                actor.translation_x = this._slideDistance();
            } else {
                actor.translation_x = 0;
                actor.opacity = 0;
            }
            actor.ease({
                translation_x: 0,
                opacity: 255,
                duration: ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else if (animated) {
            actor.ease({
                ...how === 'slide' ? {translation_x: this._slideDistance()} : {opacity: 0},
                duration: ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: () => {
                    if (!this._shown && !this._destroyed)
                        actor.visible = false;
                },
            });
        } else {
            actor.visible = false;
        }
    }

    // Docked, the pointer spending a moment on the panel and then leaving
    // is what closing is to a popup: what is in it has been looked at. A
    // pointer left parked on the panel is not looking (see LookTracker).
    _onHover() {
        const now = GLib.get_monotonic_time() / 1000;
        if (this._actor.hover)
            this._look.activity(now);
        else if (this._look.leave(now) && this._docked)
            this._acknowledge();
    }

    // Escape in a docked panel: clear the search and hand the keyboard back
    // to the windows (the Shell focuses one when the stage loses key focus).
    _leaveKeyboard() {
        this._entry.text = '';
        global.stage.set_key_focus(null);
        this._acknowledge();
    }

    _acknowledge() {
        guarded(() => this._onSeen?.());
    }

    _teardown() {
        this._releaseGrab();
        guarded(() => this._untrackStrut());

        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = null;
        }
        if (this._topBarId) {
            this._topBar.disconnect(this._topBarId);
            this._topBarId = null;
        }
        this._topBar = null;
        if (this._scaleId) {
            this._themeContext.disconnect(this._scaleId);
            this._scaleId = null;
        }
        this._themeContext = null;
        for (const id of this._overviewIds ?? [])
            Main.overview.disconnect(id);
        this._overviewIds = [];
        if (this._fullscreenId) {
            global.display.disconnect(this._fullscreenId);
            this._fullscreenId = null;
        }
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];
        if (this._desktopId) {
            this._desktop.disconnect(this._desktopId);
            this._desktopId = null;
        }
        this._desktop = null;

        this._searchListeners.clear();
        this._isToggleKey = null;
        for (const {actor} of this._sections.values()) {
            if (actor.get_parent() === this._host)
                this._host.remove_child(actor);
        }
        this._sections.clear();

        try {
            Main.ctrlAltTabManager.removeGroup(this._actor);
            this._menu?.destroy();
            this._menu = null;
            Main.layoutManager.removeChrome(this._actor);
        } finally {
            this._actor.destroy();
            this._actor = null;
            this._strut.destroy();
            this._strut = null;
        }
    }

    _slideDistance() {
        return this._actor.width + MARGIN;
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor || this._destroyed)
            return;
        const {card, strip} = panelGeometry({
            monitor,
            topBarHeight: Main.layoutManager.panelBox.height,
            scale: St.ThemeContext.get_for_stage(global.stage).scale_factor,
        });
        this._actor.set_position(card.x, card.y);
        this._actor.set_size(card.width, card.height);
        this._strut.set_position(strip.x, strip.y);
        this._strut.set_size(strip.width, strip.height);
    }

    _buildHeader() {
        const header = new St.BoxLayout({style_class: 'ns-panel-header'});
        header.add_child(new St.Label({
            text: 'Notifications',
            style_class: 'ns-panel-title',
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._count = new St.Label({
            style_class: 'ns-panel-count',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        header.add_child(this._count);

        // The setting is what holds the state; the button shows it and
        // asks for a change.
        this._pin = new St.Button({
            style_class: 'ns-panel-pin',
            icon_name: 'view-pin-symbolic',
            toggle_mode: true,
            accessible_name: 'Keep docked',
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._pin.connect('clicked', () => {
            const pinned = this._pin.checked;
            // Applied first, as a change made from the panel; the setting's
            // own `changed` then finds nothing left to do.
            this._applyPinned(pinned, {fromPanel: true});
            let written = false;
            try {
                written = this._settings.set_boolean('pinned', pinned);
            } catch (e) {
                console.error(e);
            }
            if (!written)
                this._applyPinned(this._settings.get_boolean('pinned'), {fromPanel: true});
        });
        header.add_child(this._pin);

        this._more = new St.Button({
            style_class: 'ns-panel-more',
            label: '⋯',
            accessible_name: 'More options',
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._more.connect('clicked', () => this._menu.toggle());
        header.add_child(this._more);
        this._actor.add_child(header);
    }

    _buildMenu() {
        this._menu = new PopupMenu.PopupMenu(this._more, 0.5, St.Side.TOP);
        Main.uiGroup.add_child(this._menu.actor);
        this._menu.actor.hide();
        this._menuManager = new PopupMenu.PopupMenuManager(this._more);
        this._menuManager.addMenu(this._menu);

        this._viewItems = new Map();
        for (const [value, label] of VIEWS) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => guarded(() => this._handlers.onViewChosen?.(value)));
            this._menu.addMenuItem(item);
            this._viewItems.set(value, item);
        }
        this._menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        const clear = new PopupMenu.PopupMenuItem('Clear all history');
        clear.connect('activate', () => guarded(() => this._handlers.onClearAll?.()));
        this._menu.addMenuItem(clear);
        const settings = new PopupMenu.PopupMenuItem('Settings');
        settings.connect('activate', () => guarded(() => this._handlers.onOpenSettings?.()));
        this._menu.addMenuItem(settings);
    }

    _syncViewOrnaments() {
        const view = this._settings.get_string('view');
        for (const [value, item] of this._viewItems) {
            item.setOrnament(value === view
                ? PopupMenu.Ornament.DOT : PopupMenu.Ornament.NO_DOT);
        }
    }

    _buildSearch() {
        this._entry = new St.Entry({
            style_class: 'ns-search',
            hint_text: 'Search history',
            can_focus: true,
        });
        this._entry.clutter_text.connect('text-changed', () => {
            for (const fn of [...this._searchListeners])
                guarded(() => fn(this._entry.text));
        });
        this._actor.add_child(this._entry);
    }

    _syncSearchVisible() {
        this._entry.visible = this._settings.get_boolean('show-search');
    }

    _buildBody() {
        this._host = new St.BoxLayout({
            style_class: 'ns-panel-list',
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
        });
        const scroll = new St.ScrollView({
            style_class: 'ns-panel-scroll',
            x_expand: true,
            y_expand: true,
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            child: this._host,
        });
        this._actor.add_child(scroll);
    }

    _layoutSections() {
        for (const child of this._host.get_children())
            this._host.remove_child(child);
        const sorted = [...this._sections.values()].sort((a, b) => a.order - b.order);
        for (const {actor} of sorted)
            this._host.add_child(actor);
    }

    _syncChecked(footer) {
        if (this._switch.state)
            footer.add_accessible_state(Atk.StateType.CHECKED);
        else
            footer.remove_accessible_state(Atk.StateType.CHECKED);
    }

    _buildFooter() {
        const footer = new St.BoxLayout({
            style_class: 'ns-panel-footer',
            reactive: true,
            can_focus: true,
            track_hover: true,
            accessible_name: 'Do Not Disturb',
            accessible_role: Atk.Role.CHECK_BOX,
        });
        footer.add_child(new St.Label({
            text: 'Do Not Disturb',
            style_class: 'ns-panel-footer-label',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
        this._switch = new PopupMenu.Switch(false);
        // The switch handles its own knob gestures. The row adds keyboard
        // activation and clicks elsewhere on the row; both only call
        // `toggle()`, so `notify::state` stays the single writer.
        footer.add_child(this._switch);
        const click = new Clutter.ClickGesture();
        click.connect('may-recognize', () => {
            const target = global.stage.get_event_actor(click.get_point_event(0));
            // A press on the bare track is picked as the switch itself; only
            // the knob (its one reactive child) handles its own press.
            return !(target && target !== this._switch && this._switch.contains(target));
        });
        click.connect('recognize', () => this._switch.toggle());
        footer.add_action(click);
        footer.connect('key-press-event', (_a, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_space || key === Clutter.KEY_Return ||
                key === Clutter.KEY_KP_Enter) {
                this._switch.toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._actor.add_child(footer);

        // Do Not Disturb is the inverse of the desktop's `show-banners`.
        this._desktop = new Gio.Settings({schema_id: 'org.gnome.desktop.notifications'});
        let syncing = false;
        const sync = () => {
            syncing = true;
            try {
                this._switch.state = !this._desktop.get_boolean('show-banners');
                this._syncChecked(footer);
            } finally {
                syncing = false;
            }
        };
        this._desktopId = this._desktop.connect('changed::show-banners', sync);
        sync();
        this._switch.connect('notify::state', () => {
            if (syncing)
                return;  // the change came from the setting: nothing to write
            this._syncChecked(footer);
            try {
                if (!this._desktop.set_boolean('show-banners', !this._switch.state))
                    sync();  // key not writable: no `changed` will follow
            } catch (e) {
                console.error(e);
                sync();  // the setting refused: show what it really holds
            }
        });
    }
}
