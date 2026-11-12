import {test, assertEqual, assertThrows} from './harness.js';

test('assertEqual compares deeply', () => {
    assertEqual({a: [1, 2]}, {a: [1, 2]});
});

test('assertEqual throws on mismatch', () => {
    assertThrows(() => assertEqual(1, 2));
});
