import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';

import {isSafeIconString} from './core/icon.js';

const FALLBACK_ICON = 'application-x-executable-symbolic';
const MAX_ACTIONS = 3;
const BODY_LINES = 2;

// Caps the child's height at BODY_LINES single lines; a wrapping St.Label
// given less height than it wants ellipsizes, as the Shell's own
// LabelExpanderLayout (messageList.js) relies on.
const ClampLayout = GObject.registerClass({
    GTypeName: 'NotificationSidebarClampLayout',
}, class ClampLayout extends Clutter.BinLayout {
    vfunc_get_preferred_height(container, forWidth) {
        const child = container.get_first_child();
        if (!child)
            return [0, 0];
        const [, oneLine] = child.get_preferred_height(-1);
        const [min, nat] = child.get_preferred_height(forWidth);
        const cap = oneLine * BODY_LINES;
        return [Math.floor(Math.min(min, cap)), Math.floor(Math.min(nat, cap))];
    }
});

function guarded(fn) {
    return (...args) => {
        try {
            fn(...args);
        } catch (e) {
            console.error(e);
        }
    };
}

function lookupApp(appId) {
    if (!appId)
        return null;
    try {
        return Shell.AppSystem.get_default().lookup_app(appId);
    } catch (e) {
        console.error(e);
        return null;
    }
}

// Unsafe strings (a themed-icon form with no names would crash the Shell
// inside Gio) fall through to the app's icon.
function gicon(icon, appId) {
    if (isSafeIconString(icon)) {
        try {
            return Gio.icon_new_for_string(icon);
        } catch (e) {
            // Not a parseable icon string: fall through to the app's icon.
        }
    }
    return lookupApp(appId)?.get_icon() ?? null;
}

function makeIcon(icon, appId, styleClass) {
    return new St.Icon({
        style_class: styleClass,
        gicon: gicon(icon, appId),
        fallback_icon_name: FALLBACK_ICON,
        y_align: Clutter.ActorAlign.START,
    });
}

// Plain text only: `clutter_text.set_text`, never markup.
function makeLabel(text, styleClass, props = {}) {
    const label = new St.Label({style_class: styleClass, ...props});
    label.clutter_text.set_text(text ?? '');
    return label;
}

function makeDot() {
    return new St.Widget({style_class: 'ns-dot', y_align: Clutter.ActorAlign.CENTER});
}

// A row is a non-focusable, hover-tracking container holding sibling
// buttons: the main area (activates), the remove button and, on cards, the
// action buttons. Being siblings rather than nested, a press reaches exactly
// one St.Button, and each one is its own Tab stop.
function makeRow(item, handlers, styleClass) {
    const row = new St.BoxLayout({
        style_class: `ns-row ${styleClass}`,
        orientation: Clutter.Orientation.VERTICAL,
        reactive: true,
        track_hover: true,
        x_expand: true,
    });
    if (item.isPrevious)
        row.add_style_class_name('previous');
    if (item.isNew)
        row.add_style_class_name('new');

    const top = new St.BoxLayout({x_expand: true});
    row.add_child(top);

    const activatable = handlers.canActivate(item);
    const main = new St.Button({
        style_class: 'ns-row-main',
        can_focus: true,
        reactive: activatable,
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
    });
    if (activatable)
        main.connect('clicked', guarded(() => handlers.onActivate(item.record)));
    top.add_child(main);

    const remove = new St.Button({
        style_class: 'ns-remove',
        icon_name: 'window-close-symbolic',
        accessible_name: 'Remove',
        can_focus: true,
        y_align: Clutter.ActorAlign.START,
    });
    remove.connect('clicked', guarded(() => handlers.onRemove(item.record)));
    top.add_child(remove);

    return {row, main, remove};
}

// The remove button is shown while the row is hovered or anything in it has
// keyboard focus. It is hidden with opacity, not `visible`, so it stays a
// Tab stop; while hidden it is not reactive, so a tap cannot hit it unseen.
function trackRemoveVisibility(row, remove, focusables) {
    const sync = () => {
        const show = row.hover || focusables.some(a => a.has_key_focus());
        remove.opacity = show ? 255 : 0;
        remove.reactive = show;
    };
    row.connect('notify::hover', sync);
    for (const actor of focusables) {
        actor.connect('key-focus-in', sync);
        actor.connect('key-focus-out', sync);
    }
    sync();
}

function createCard(item, handlers) {
    const {record} = item;
    const {row, main, remove} = makeRow(item, handlers, 'ns-card');

    const content = new St.BoxLayout({style_class: 'ns-card-content', x_expand: true});
    content.add_child(makeIcon(record.icon, record.appId, 'ns-card-icon'));
    const text = new St.BoxLayout({
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    content.add_child(text);

    const header = new St.BoxLayout({style_class: 'ns-card-header'});
    header.add_child(makeLabel(record.appName, 'ns-card-app', {x_expand: true}));
    header.add_child(makeLabel(item.timeText, 'ns-time'));
    if (item.isNew)
        header.add_child(makeDot());
    text.add_child(header);

    text.add_child(makeLabel(record.title, 'ns-card-title'));

    if (record.body) {
        const body = makeLabel(record.body, 'ns-card-body', {x_expand: true});
        body.clutter_text.line_wrap = true;
        body.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
        body.clutter_text.ellipsize = Pango.EllipsizeMode.END;
        text.add_child(new St.Bin({
            x_expand: true,
            layout_manager: new ClampLayout(),
            child: body,
        }));
    }
    main.set_child(content);

    const focusables = [main, remove];
    const actions = item.isLive && item.hasActions
        ? handlers.getActions(record).slice(0, MAX_ACTIONS) : [];
    if (actions.length > 0) {
        const box = new St.BoxLayout({style_class: 'ns-actions', x_expand: true});
        for (const action of actions) {
            const button = new St.Button({
                style_class: 'ns-action',
                label: action.label,
                can_focus: true,
                x_expand: true,
            });
            button.connect('clicked', guarded(() => handlers.onAction(record, action)));
            box.add_child(button);
            focusables.push(button);
        }
        row.add_child(box);
    }

    trackRemoveVisibility(row, remove, focusables);
    return row;
}

function createLine(item, handlers) {
    const {record} = item;
    const {row, main, remove} = makeRow(item, handlers, 'ns-line');

    const content = new St.BoxLayout({style_class: 'ns-line-content', x_expand: true});
    const icon = makeIcon(record.icon, record.appId, 'ns-line-icon');
    icon.y_align = Clutter.ActorAlign.CENTER;
    content.add_child(icon);
    content.add_child(makeLabel(record.title, 'ns-line-title', {
        y_align: Clutter.ActorAlign.CENTER,
    }));
    content.add_child(makeLabel(record.body, 'ns-line-body', {
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    content.add_child(makeLabel(item.timeText, 'ns-time', {y_align: Clutter.ActorAlign.CENTER}));
    if (item.isNew)
        content.add_child(makeDot());
    main.set_child(content);

    remove.y_align = Clutter.ActorAlign.CENTER;
    trackRemoveVisibility(row, remove, [main, remove]);
    return row;
}

function createMore(item, handlers) {
    const button = new St.Button({
        style_class: 'ns-row ns-more',
        label: item.text,
        can_focus: true,
        x_expand: true,
        x_align: Clutter.ActorAlign.FILL,
    });
    button.get_child().x_align = Clutter.ActorAlign.START;
    button.connect('clicked', guarded(() => handlers.onMore(item.key)));
    return button;
}

function createHeading(item) {
    const box = new St.BoxLayout({style_class: 'ns-heading', x_expand: true});
    if (item.isNew) {
        box.add_style_class_name('new');
        box.add_child(new St.Widget({style_class: 'ns-heading-rule', y_align: Clutter.ActorAlign.CENTER}));
    }
    box.add_child(makeLabel(item.text, 'ns-heading-label', {y_align: Clutter.ActorAlign.CENTER}));
    if (item.isNew) {
        box.add_child(new St.Widget({
            style_class: 'ns-heading-rule',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }
    return box;
}

function createGroup(item, handlers) {
    const group = new St.BoxLayout({
        style_class: 'ns-group',
        orientation: Clutter.Orientation.VERTICAL,
        x_expand: true,
    });
    const header = new St.BoxLayout({style_class: 'ns-group-header'});
    const appId = item.key.startsWith('name:') ? null : item.key;
    const icon = makeIcon(item.icon, appId, 'ns-card-icon');
    icon.y_align = Clutter.ActorAlign.CENTER;
    header.add_child(icon);
    header.add_child(makeLabel(item.appName, 'ns-group-app', {y_align: Clutter.ActorAlign.CENTER}));
    if (item.newCount > 0) {
        header.add_child(makeLabel(`${item.newCount} new`, 'ns-pill', {
            y_align: Clutter.ActorAlign.CENTER,
        }));
    }
    header.add_child(makeLabel(item.timeText, 'ns-time', {
        x_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.CENTER,
    }));
    group.add_child(header);

    // A row that fails to build is skipped; the rest of the block still shows.
    for (const sub of item.rows) {
        let actor;
        try {
            actor = createItemActor(sub, handlers);
        } catch (e) {
            handlers.onItemError(e);
            continue;
        }
        actor.add_style_class_name('in-group');
        group.add_child(actor);
    }
    return group;
}

/**
 * Builds the actor for one view-model item.
 *
 * `handlers`: `{onActivate(record), onRemove(record), onAction(record, action),
 * onMore(key)}` plus two queries the view model does not answer:
 * `canActivate(item)` (is there a live notification or an app to open) and
 * `getActions(record)` (the live notification's actions), and
 * `onItemError(error)`, told about a row inside a group that was skipped
 * because it could not be built.
 */
export function createItemActor(item, handlers) {
    switch (item.kind) {
    case 'heading':
        return createHeading(item);
    case 'card':
        return createCard(item, handlers);
    case 'line':
        return createLine(item, handlers);
    case 'group':
        return createGroup(item, handlers);
    case 'more':
        return createMore(item, handlers);
    default:
        throw new Error(`unknown item kind: ${item.kind}`);
    }
}
