import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class NotificationSidebarExtension extends Extension {
    enable() {
        console.log('[notification-sidebar] enabled');
    }

    disable() {
        console.log('[notification-sidebar] disabled');
    }
}
