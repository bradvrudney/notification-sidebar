import Gio from 'gi://Gio';
import {test, assertTrue} from './harness.js';
import {isSafeIconString} from '../extension/lib/core/icon.js';

// Only strings that are safe are ever handed to Gio here; the unsafe ones
// would crash the test process.
test('icon: plain names, paths and URIs are safe', () => {
    assertTrue(isSafeIconString('dialog-information-symbolic'));
    assertTrue(isSafeIconString('/usr/share/icons/x.png'));
    assertTrue(isSafeIconString('file:///usr/share/icons/x.png'));
});
test('icon: themed-icon forms with names are safe, as Gio writes them', () => {
    const s = Gio.ThemedIcon.new_from_names(['a-symbolic', 'b']).to_string();
    assertTrue(s.startsWith('. GThemedIcon '));
    assertTrue(isSafeIconString(s));
    assertTrue(Gio.icon_new_for_string(s) !== null);
});
test('icon: an emblemed icon as Gio writes it is safe', () => {
    const base = Gio.ThemedIcon.new_from_names(['a', 'b']);
    const emblem = Gio.Emblem.new(Gio.ThemedIcon.new_from_names(['c', 'd']));
    const s = Gio.EmblemedIcon.new(base, emblem).to_string();
    assertTrue(isSafeIconString(s));
});
test('icon: themed-icon forms with no names are rejected', () => {
    assertTrue(!isSafeIconString('. GThemedIcon'));
    assertTrue(!isSafeIconString('. GThemedIcon '));
    assertTrue(!isSafeIconString('. GThemedIcon  '));
    assertTrue(!isSafeIconString('. GThemedIcon a  b'));
});
test('icon: a nested themed icon with no names is rejected', () => {
    const base = Gio.ThemedIcon.new_from_names(['a', 'b']);
    const emblem = Gio.Emblem.new(Gio.ThemedIcon.new_from_names(['c', 'd']));
    const good = Gio.EmblemedIcon.new(base, emblem).to_string();
    const tokens = good.split(' ');
    assertTrue(tokens[1] === 'GEmblemedIcon' && tokens.length === 4);
    assertTrue(!isSafeIconString([...tokens.slice(0, 2), '.%20GThemedIcon', tokens[3]].join(' ')));
    // One level deeper: inside the emblem.
    assertTrue(!isSafeIconString(
        [...tokens.slice(0, 3), '.%20GEmblem%20.%2520GThemedIcon%200'].join(' ')));
});
test('icon: empty, blank and non-strings are rejected', () => {
    assertTrue(!isSafeIconString(''));
    assertTrue(!isSafeIconString('   '));
    assertTrue(!isSafeIconString(null));
    assertTrue(!isSafeIconString(undefined));
    assertTrue(!isSafeIconString(42));
});
