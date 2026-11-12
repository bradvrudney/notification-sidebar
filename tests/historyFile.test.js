import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import {test, assertEqual, assertTrue} from './harness.js';
import {loadHistory, saveHistory, DebouncedSaver, historyPath, quarantineHistory} from '../extension/lib/core/historyFile.js';

const OBJ = {version: 1, lastSeen: 5, records: []};

function withTmp(fn) {
    const dir = GLib.Dir.make_tmp('nsb-history-XXXXXX');
    try {
        return fn(dir);
    } finally {
        GLib.spawn_command_line_sync(`chmod -R u+rwx ${GLib.shell_quote(dir)}`);
        GLib.spawn_command_line_sync(`rm -rf ${GLib.shell_quote(dir)}`);
    }
}

function fakeTimers() {
    const t = {next: 1, active: new Map(), cleared: [], sets: 0};
    t.setTimer = (fn, _ms) => {
        t.sets++;
        const id = t.next++;
        t.active.set(id, fn);
        return id;
    };
    t.clearTimer = id => {
        t.cleared.push(id);
        t.active.delete(id);
    };
    t.fire = () => {
        for (const [id, fn] of [...t.active]) {
            t.active.delete(id);
            fn();
        }
    };
    return t;
}

test('historyFile: missing file loads as no data and no quarantine', () => withTmp(tmp => {
    assertEqual(loadHistory(`${tmp}/none.json`), {data: null, quarantined: null, preserve: false});
}));
test('historyFile: save then load round trips', () => withTmp(tmp => {
    const p = `${tmp}/h.json`;
    assertTrue(saveHistory(p, OBJ) === true);
    assertEqual(loadHistory(p).data, OBJ);
}));
test('historyFile: saved file mode is 0600', () => withTmp(tmp => {
    const p = `${tmp}/h.json`;
    saveHistory(p, OBJ);
    const info = Gio.File.new_for_path(p).query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
    assertTrue((info.get_attribute_uint32('unix::mode') & 0o777) === 0o600);
}));
test('historyFile: save creates nested parent directories', () => withTmp(tmp => {
    assertTrue(saveHistory(`${tmp}/a/b/h.json`, OBJ) === true);
}));
test('historyFile: corrupt file is quarantined and reported as no data', () => withTmp(tmp => {
    const p = `${tmp}/h.json`;
    GLib.file_set_contents(p, '{not json');
    const errors = [];
    const r = loadHistory(p, {onError: e => errors.push(e)});
    assertEqual(r.data, null);
    assertTrue(/\.corrupt-\d+$/.test(r.quarantined));
    assertTrue(r.quarantined.startsWith(`${p}.corrupt-`));
    assertTrue(GLib.file_test(r.quarantined, GLib.FileTest.EXISTS));
    assertTrue(!GLib.file_test(p, GLib.FileTest.EXISTS));
    assertEqual(r.preserve, false);
    assertEqual(errors.length, 1);
}));
test('historyFile: unreadable file is moved aside, not left to be overwritten', () => withTmp(tmp => {
    const p = `${tmp}/h.json`;
    saveHistory(p, OBJ);
    GLib.chmod(p, 0o000);
    const errors = [];
    const r = loadHistory(p, {onError: e => errors.push(e)});
    assertEqual(r.data, null);
    assertEqual(r.preserve, false);
    assertTrue(r.quarantined !== null && r.quarantined.startsWith(`${p}.corrupt-`));
    assertTrue(GLib.file_test(r.quarantined, GLib.FileTest.EXISTS));
    assertTrue(!GLib.file_test(p, GLib.FileTest.EXISTS));
    assertTrue(errors.length >= 1);
}));
test('historyFile: corrupt file that cannot be moved aside is reported as preserve', () => withTmp(tmp => {
    const p = `${tmp}/d/h.json`;
    saveHistory(p, OBJ);
    GLib.file_set_contents(p, '{not json');
    GLib.chmod(`${tmp}/d`, 0o500);
    const errors = [];
    const r = loadHistory(p, {onError: e => errors.push(e)});
    assertEqual(r, {data: null, quarantined: null, preserve: true});
    assertTrue(GLib.file_test(p, GLib.FileTest.EXISTS));
    assertEqual(errors.length, 2);
}));
test('historyFile: unreadable file that cannot be moved aside is reported as preserve', () => withTmp(tmp => {
    const p = `${tmp}/d/h.json`;
    saveHistory(p, OBJ);
    GLib.chmod(p, 0o000);
    GLib.chmod(`${tmp}/d`, 0o500);
    const r = loadHistory(p, {onError: () => {}});
    assertEqual(r, {data: null, quarantined: null, preserve: true});
    assertTrue(GLib.file_test(p, GLib.FileTest.EXISTS));
}));
test('historyFile: readable file loads with preserve false', () => withTmp(tmp => {
    const p = `${tmp}/h.json`;
    saveHistory(p, OBJ);
    assertEqual(loadHistory(p), {data: OBJ, quarantined: null, preserve: false});
}));
test('historyFile: unwritable path returns false and does not throw', () => {
    const errors = [];
    assertTrue(saveHistory('/proc/nope/h.json', OBJ, {onError: e => errors.push(e)}) === false);
    assertEqual(errors.length, 1);
});
test('historyFile: historyPath is under the user data dir', () => {
    assertEqual(historyPath(), `${GLib.get_user_data_dir()}/notification-sidebar/history.json`);
});
test('debounce: 500 schedules call saveFn 0 times until the timer fires, then once', () => {
    const t = fakeTimers();
    let calls = 0;
    const s = new DebouncedSaver(() => calls++, {setTimer: t.setTimer, clearTimer: t.clearTimer});
    for (let i = 0; i < 500; i++)
        s.schedule();
    assertEqual(calls, 0);
    t.fire();
    assertEqual(calls, 1);
});
test('debounce: flush runs a pending save once and is then a no-op', () => {
    const t = fakeTimers();
    let calls = 0;
    const s = new DebouncedSaver(() => calls++, {setTimer: t.setTimer, clearTimer: t.clearTimer});
    s.schedule();
    s.flush();
    assertEqual(calls, 1);
    s.flush();
    assertEqual(calls, 1);
});
test('debounce: destroy flushes pending save and clears the timer', () => {
    const t = fakeTimers();
    let calls = 0;
    const s = new DebouncedSaver(() => calls++, {setTimer: t.setTimer, clearTimer: t.clearTimer});
    s.schedule();
    s.destroy();
    assertEqual(calls, 1);
    assertEqual(t.cleared.length, 1);
    assertEqual(t.active.size, 0);
});
test('debounce: schedule after destroy arms no timer', () => {
    const t = fakeTimers();
    let calls = 0;
    const s = new DebouncedSaver(() => calls++, {setTimer: t.setTimer, clearTimer: t.clearTimer});
    s.destroy();
    s.schedule();
    assertEqual(t.sets, 0);
    assertEqual(t.active.size, 0);
    s.flush();
    assertEqual(calls, 0);
});
test('historyFile: quarantineHistory moves a valid-JSON file aside', () => withTmp(tmp => {
    const p = `${tmp}/h.json`;
    saveHistory(p, {version: 99});
    const q = quarantineHistory(p);
    assertTrue(q !== null && q.startsWith(`${p}.corrupt-`));
    assertEqual(loadHistory(p), {data: null, quarantined: null, preserve: false});
    assertEqual(loadHistory(q, {onError: () => {}}).data, {version: 99});
}));
