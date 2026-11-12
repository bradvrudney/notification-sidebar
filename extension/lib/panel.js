import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

const PANEL_WIDTH = 344;
const MARGIN = 6;
const ANIMATION_MS = 200;

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

export class SidebarPanel {
    constructor({settings, onOpened, onClosed}) {
        this._settings = settings;
        this._onOpened = onOpened;
        this._onClosed = onClosed;
        this._open = false;
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
            visible: false,
        });
        this._actor.connect('key-press-event', (_a, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Escape) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        // The modal grab routes every event through the grab actor, so a press
        // outside the panel shows up here.
        this._actor.connect('captured-event', (_a, event) => {
            const type = event.type();
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
        // Lets Tab / Shift+Tab move focus between the search entry, the menu
        // button and the Do Not Disturb row, as ModalDialog and PopupMenu do.
        global.focus_manager.add_group(this._actor);
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => this._reposition());
        this._reposition();

        // Created after the actor so the popup is stacked above the panel.
        this._buildMenu();

        this._settingsIds.push(
            this._settings.connect('changed::show-search', () => this._syncSearchVisible()),
            this._settings.connect('changed::view', () => this._syncViewOrnaments()));
        this._syncSearchVisible();
        this._syncViewOrnaments();
    }

    get isOpen() {
        return this._open;
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
        const grab = Main.pushModal(this._actor);
        this._grab = grab;
        this._open = true;

        guarded(() => this._onOpened?.());

        this._actor.remove_all_transitions();
        this._actor.visible = true;
        if (St.Settings.get().enable_animations) {
            this._actor.translation_x = this._slideDistance();
            this._actor.ease({
                translation_x: 0,
                duration: ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
        } else {
            this._actor.translation_x = 0;
        }
    }

    close({animate = true} = {}) {
        if (!this._open)
            return;
        this._open = false;

        guarded(() => this._menu?.close({animate: false}));
        if (this._grab) {
            const grab = this._grab;
            this._grab = null;
            try {
                Main.popModal(grab);
            } catch (e) {
                console.error(e);
            }
        }
        this._entry.text = '';

        this._actor.remove_all_transitions();
        if (animate && St.Settings.get().enable_animations) {
            this._actor.ease({
                translation_x: this._slideDistance(),
                duration: ANIMATION_MS,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: () => {
                    if (!this._open && !this._destroyed)
                        this._actor.visible = false;
                },
            });
        } else {
            this._actor.visible = false;
        }

        guarded(() => this._onClosed?.());
    }

    toggle() {
        if (this._open)
            this.close();
        else
            this.open();
    }

    destroy() {
        if (this._destroyed)
            return;
        try {
            this.close({animate: false});
        } finally {
            this._destroyed = true;
            this._teardown();
        }
    }

    _teardown() {
        if (this._grab) {
            const grab = this._grab;
            this._grab = null;
            guarded(() => Main.popModal(grab));
        }

        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = null;
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
            global.focus_manager.remove_group(this._actor);
            this._menu?.destroy();
            this._menu = null;
            Main.layoutManager.removeChrome(this._actor);
        } finally {
            this._actor.destroy();
            this._actor = null;
        }
    }

    _slideDistance() {
        return this._actor.width + MARGIN;
    }

    _reposition() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        const width = PANEL_WIDTH * scale;
        const margin = MARGIN * scale;
        const top = monitor.y + Main.layoutManager.panelBox.height + margin;
        this._actor.set_position(monitor.x + monitor.width - width - margin, top);
        this._actor.set_size(width, Math.max(0, monitor.y + monitor.height - margin - top));
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

        this._more = new St.Button({
            style_class: 'ns-panel-more',
            label: '⋯',
            accessible_name: 'More options',
            can_focus: true,
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
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
