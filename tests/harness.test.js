import {test, assertEqual, assertTrue, assertThrows, attempt} from './harness.js';

test('assertEqual compares deeply', () => {
    assertEqual({a: [1, 2]}, {a: [1, 2]});
});

test('assertEqual throws on mismatch', () => {
    assertThrows(() => assertEqual(1, 2));
});

test('async failure is reported as failure', async () => {
    const err = await attempt(async () => {
        await Promise.resolve();
        throw new Error('boom');
    });
    assertTrue(err !== null);
    assertEqual(err.message, 'boom');
});

test('async success is reported as success', async () => {
    assertEqual(await attempt(async () => {}), null);
});
