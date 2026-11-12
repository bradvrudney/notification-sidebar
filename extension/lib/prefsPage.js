import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

const VIEWS = [
    ['timeline', 'Timeline'],
    ['by-app', 'By app'],
    ['new-then-history', 'New, then history'],
];

// Builds the settings page. Kept apart from prefs.js so it can be built
// without the Shell's preferences classes. Returns the page; the settings
// connections live as long as the page widget does.
export function buildPrefsPage(settings) {
    const page = new Adw.PreferencesPage();
    const group = new Adw.PreferencesGroup({title: 'Sidebar'});
    page.add(group);

    const view = new Adw.ComboRow({
        title: 'View',
        model: Gtk.StringList.new(VIEWS.map(([, name]) => name)),
    });
    const syncView = () => {
        const index = VIEWS.findIndex(([value]) => value === settings.get_string('view'));
        if (index >= 0 && view.selected !== index)
            view.selected = index;
    };
    syncView();
    view.connect('notify::selected', () => {
        const entry = VIEWS[view.selected];
        if (entry && settings.get_string('view') !== entry[0])
            settings.set_string('view', entry[0]);
    });
    group.add(view);

    const days = new Adw.SpinRow({
        title: 'Keep history for',
        subtitle: 'Days',
        adjustment: new Gtk.Adjustment({lower: 1, upper: 90, step_increment: 1, page_increment: 7}),
    });
    settings.bind('retention-days', days, 'value', Gio.SettingsBindFlags.DEFAULT);
    group.add(days);

    const search = new Adw.SwitchRow({title: 'Show search'});
    settings.bind('show-search', search, 'active', Gio.SettingsBindFlags.DEFAULT);
    group.add(search);

    // Follows changes made elsewhere, such as the panel's menu.
    const viewId = settings.connect('changed::view', syncView);
    page.connect('destroy', () => settings.disconnect(viewId));
    return page;
}
