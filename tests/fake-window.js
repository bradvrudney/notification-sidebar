// A plain application window on the isolated session's compositor, for the
// dock checks in tests/smoke-driver (maximise, fullscreen, keyboard focus).
// Started and killed by scripts/smoke.sh.
import Gtk from 'gi://Gtk?version=4.0';

const app = new Gtk.Application({application_id: 'com.example.NsSmokeWindow'});
app.connect('activate', () => {
    const win = new Gtk.ApplicationWindow({
        application: app,
        title: 'ns-smoke-window',
        default_width: 400,
        default_height: 300,
    });
    win.present();
});
app.run([]);
