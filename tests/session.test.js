import GLib from 'gi://GLib';
import {test, assertEqual, assertTrue} from './harness.js';
import {parseStartTime, composeSessionId} from '../extension/lib/core/session.js';

// Fields 3..21, then 22 = start time, then a few more.
const tail = start =>
    `S 1 2 3 0 -1 4194560 100 0 0 0 5 6 0 0 20 0 12 0 ${start} 123456 789 18446744073709551615`;

test('session: parseStartTime reads field 22 of a plain stat line', () => {
    assertEqual(parseStartTime(`2412 (gnome-shell) ${tail(98765)}`), '98765');
});
test('session: parseStartTime handles a comm containing ") " and spaces', () => {
    assertEqual(parseStartTime(`77 (a) b (c) d ) ${tail(4242)}`), '4242');
});
test('session: parseStartTime rejects malformed text', () => {
    assertEqual(parseStartTime(''), null);
    assertEqual(parseStartTime(null), null);
    assertEqual(parseStartTime('12 gnome-shell S 1 2'), null);
    assertEqual(parseStartTime('12 (gnome-shell) S 1 2 3'), null);
    assertEqual(parseStartTime(`12 (x) ${tail('12a')}`), null);
});
test('session: parseStartTime reads this process\'s own stat', () => {
    const [, bytes] = GLib.file_get_contents('/proc/self/stat');
    assertTrue(/^\d+$/.test(parseStartTime(new TextDecoder().decode(bytes))));
});
test('session: composeSessionId uses boot id and start time', () => {
    assertEqual(composeSessionId('boot', `1 (gnome-shell) ${tail(55)}`, '3'), 'boot:start-55');
});
test('session: composeSessionId differs for another start time in the same boot', () => {
    assertTrue(composeSessionId('boot', `1 (s) ${tail(55)}`, null) !==
        composeSessionId('boot', `9 (s) ${tail(56)}`, null));
});
test('session: composeSessionId falls back to the login session id', () => {
    assertEqual(composeSessionId('boot', '', '3'), 'boot:session-3');
    assertEqual(composeSessionId('boot', null, null), 'boot:session-');
});
