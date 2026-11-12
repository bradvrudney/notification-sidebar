// Test-only fake media player for scripts/smoke.sh. Owns
// org.mpris.MediaPlayer2.NsSmoke on the (isolated) session bus and serves the
// parts of MPRIS that the Shell's MprisPlayer reads. PlayPause flips the
// playback status; Quit exits, which drops the name. Run with `gjs -m`.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const NAME = 'org.mpris.MediaPlayer2.NsSmoke';
const PATH = '/org/mpris/MediaPlayer2';
const PLAYER_IFACE = 'org.mpris.MediaPlayer2.Player';

const ROOT_XML = `<node><interface name="org.mpris.MediaPlayer2">
  <method name="Raise"/>
  <method name="Quit"/>
  <property name="CanQuit" type="b" access="read"/>
  <property name="CanRaise" type="b" access="read"/>
  <property name="HasTrackList" type="b" access="read"/>
  <property name="Identity" type="s" access="read"/>
  <property name="DesktopEntry" type="s" access="read"/>
  <property name="SupportedUriSchemes" type="as" access="read"/>
  <property name="SupportedMimeTypes" type="as" access="read"/>
</interface></node>`;

const PLAYER_XML = `<node><interface name="${PLAYER_IFACE}">
  <method name="PlayPause"/>
  <method name="Next"/>
  <method name="Previous"/>
  <property name="CanGoNext" type="b" access="read"/>
  <property name="CanGoPrevious" type="b" access="read"/>
  <property name="CanPlay" type="b" access="read"/>
  <property name="CanPause" type="b" access="read"/>
  <property name="CanControl" type="b" access="read"/>
  <property name="Metadata" type="a{sv}" access="read"/>
  <property name="PlaybackStatus" type="s" access="read"/>
</interface></node>`;

const loop = new GLib.MainLoop(null, false);
let status = 'Paused';
let connection = null;

const root = {
    Raise() {},
    Quit() {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
    },
    CanQuit: true,
    CanRaise: false,
    HasTrackList: false,
    Identity: 'Smoke player',
    DesktopEntry: '',
    SupportedUriSchemes: [],
    SupportedMimeTypes: [],
};

const player = {
    PlayPause() {
        status = status === 'Playing' ? 'Paused' : 'Playing';
        connection.emit_signal(null, PATH, 'org.freedesktop.DBus.Properties',
            'PropertiesChanged', new GLib.Variant('(sa{sv}as)', [
                PLAYER_IFACE, {PlaybackStatus: new GLib.Variant('s', status)}, [],
            ]));
    },
    Next() {},
    Previous() {},
    CanGoNext: true,
    CanGoPrevious: true,
    CanPlay: true,
    CanPause: true,
    CanControl: true,
    get Metadata() {
        return {
            'mpris:trackid': new GLib.Variant('o', '/org/ns/smoke/track/1'),
            'xesam:title': new GLib.Variant('s', 'Smoke track'),
            'xesam:artist': new GLib.Variant('as', ['Smoke artist']),
        };
    },
    get PlaybackStatus() {
        return status;
    },
};

const rootObj = Gio.DBusExportedObject.wrapJSObject(ROOT_XML, root);
const playerObj = Gio.DBusExportedObject.wrapJSObject(PLAYER_XML, player);

Gio.bus_own_name(Gio.BusType.SESSION, NAME, Gio.BusNameOwnerFlags.NONE,
    conn => {
        connection = conn;
        rootObj.export(conn, PATH);
        playerObj.export(conn, PATH);
    },
    () => print('fake-mpris-player: ready'),
    () => {
        printerr('fake-mpris-player: lost the bus name');
        loop.quit();
    });

loop.run();
rootObj.unexport();
playerObj.unexport();
