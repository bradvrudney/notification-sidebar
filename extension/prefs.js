import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {buildPrefsPage} from './lib/prefsPage.js';

export default class NotificationSidebarPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window._settings = this.getSettings();
        window.add(buildPrefsPage(window._settings));
    }
}
