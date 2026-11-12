import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export function countText(n) {
    return n > 99 ? '99+' : String(n);
}

export const Indicator = GObject.registerClass(
class NotificationSidebarIndicator extends PanelMenu.Button {
    // `dontCreateMenu` gives a PopupDummyMenu and disables the Button's own
    // click gesture, so the toggle is wired here.
    _init({onToggle}) {
        super._init(0.5, 'Notifications', true);
        this._onToggle = onToggle;

        const box = new St.BoxLayout({style_class: 'panel-status-indicators-box'});
        this._icon = new St.Icon({
            icon_name: 'preferences-system-notifications-symbolic',
            style_class: 'system-status-icon',
        });
        this._label = new St.Label({
            style_class: 'ns-bell-count',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        box.add_child(this._icon);
        box.add_child(this._label);
        this.add_child(box);

        const gesture = new Clutter.ClickGesture();
        gesture.set_recognize_on_press(true);
        gesture.connect('recognize', () => this._toggle());
        this.add_action(gesture);

        this.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            if (key === Clutter.KEY_Return || key === Clutter.KEY_KP_Enter ||
                key === Clutter.KEY_space) {
                this._toggle();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
    }

    _toggle() {
        try {
            this._onToggle();
        } catch (e) {
            console.error(e);
        }
    }

    setCount(n) {
        this._label.visible = n > 0;
        this._label.text = n > 0 ? countText(n) : '';
    }
});
