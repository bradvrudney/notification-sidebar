import {test, assertEqual, assertTrue, assertThrows} from './harness.js';
import {HistoryStore} from '../extension/lib/core/store.js';
import {at, rec, SAMPLE, NOW, LAST_SEEN} from './fixtures.js';

const times = s => s.records.map(r => r.time);

test('store: records are newest first', () => {
    const s = new HistoryStore({now: () => 100});
    s.add(rec({time: 10}));
    s.add(rec({time: 30}));
    s.add(rec({time: 20}));
    assertEqual(times(s), [30, 20, 10]);
});
test('store: equal times put the later insertion first', () => {
    const s = new HistoryStore({now: () => 100});
    s.add(rec({id: 'a', time: 10}));
    s.add(rec({id: 'b', time: 10}));
    assertEqual(s.records.map(r => r.id), ['b', 'a']);
});
test('store: future-dated record stays, sorts first and counts as new', () => {
    const s = new HistoryStore({now: () => 100});
    s.add(rec({time: 50}));
    s.add(rec({time: 999}));
    s.prune();
    assertEqual(times(s), [999, 50]);
    s.markSeen();
    assertEqual(s.lastSeen, 100);
    assertEqual(s.newCount(), 1);
});
test('store: lastSeen 0 counts all as new, markSeen resets', () => {
    const s = new HistoryStore({now: () => 1000});
    s.add(rec({time: 10}));
    s.add(rec({time: 20}));
    assertEqual(s.lastSeen, 0);
    assertEqual(s.newCount(), s.records.length);
    s.markSeen();
    assertEqual(s.newCount(), 0);
});
test('store: retention prunes old records and returns count', () => {
    const now = at('2026-11-12 14:40');
    const s = new HistoryStore({now: () => now, retentionDays: 7});
    s.add(rec({id: 'old', time: now - 8 * 86400}));
    s.add(rec({id: 'ok', time: now - 6 * 86400}));
    assertEqual(s.prune(), 1);
    assertEqual(s.records.map(r => r.id), ['ok']);
});
test('store: clock moving back prunes nothing', () => {
    let now = 100000;
    const s = new HistoryStore({now: () => now});
    s.add(rec({time: 100}));
    s.add(rec({time: 200}));
    now = 0;
    assertEqual(s.prune(), 0);
    assertEqual(s.records.length, 2);
});
test('store: cap keeps the newest maxRecords', () => {
    const s = new HistoryStore({now: () => 1000, maxRecords: 3});
    for (const t of [1, 2, 3, 4, 5])
        s.add(rec({time: t}));
    s.prune();
    assertEqual(times(s), [5, 4, 3]);
});
test('store: update patches, re-sorts and notifies once', () => {
    const s = new HistoryStore({now: () => 1000});
    s.add(rec({id: 'a', time: 10}));
    s.add(rec({id: 'b', time: 90}));
    let n = 0;
    s.subscribe(() => n++);
    assertTrue(s.update('b', {title: 'x', time: 5}));
    assertEqual(n, 1);
    assertEqual(s.records.map(r => r.id), ['a', 'b']);
    assertEqual(s.get('b').title, 'x');
    assertEqual(s.get('b').time, 5);
});
test('store: update of unknown id returns false and does not notify', () => {
    const s = new HistoryStore({now: () => 1000});
    let n = 0;
    s.subscribe(() => n++);
    assertEqual(s.update('nope', {title: 'x'}), false);
    assertEqual(n, 0);
});
test('store: remove of unknown id is false, remove of known is true', () => {
    const s = new HistoryStore({now: () => 1000});
    s.add(rec({id: 'a'}));
    assertEqual(s.remove('nope'), false);
    assertEqual(s.remove('a'), true);
    assertEqual(s.records.length, 0);
});
test('store: clear empties and notifies', () => {
    const s = new HistoryStore({now: () => 1000});
    s.add(rec());
    let n = 0;
    s.subscribe(() => n++);
    s.clear();
    assertEqual(s.records.length, 0);
    assertEqual(n, 1);
});
test('store: add and remove notify; unsubscribe stops notifications', () => {
    const s = new HistoryStore({now: () => 1000});
    let n = 0;
    const off = s.subscribe(() => n++);
    s.add(rec({id: 'a'}));
    s.remove('a');
    assertEqual(n, 2);
    off();
    s.add(rec());
    assertEqual(n, 2);
});
test('store: find returns the stored record, null for another session', () => {
    const s = new HistoryStore({now: () => 1000});
    const r = rec({appName: 'App', title: 'T', body: 'B', time: 50});
    s.add(r);
    const f = {appName: 'App', title: 'T', body: 'B', isMarkup: false, time: 50};
    assertEqual(s.find(f, 'cur'), r);
    assertEqual(s.find(f, 'other'), null);
});
test('store: setRetentionDays prunes', () => {
    const s = new HistoryStore({now: () => 10 * 86400, retentionDays: 30});
    s.add(rec({time: 10 * 86400 - 3 * 86400}));
    assertEqual(s.records.length, 1);
    s.setRetentionDays(2);
    assertEqual(s.records.length, 0);
});
test('store: json round-trips records and lastSeen', () => {
    const s = new HistoryStore({now: () => NOW});
    for (const r of SAMPLE)
        s.add({...r});
    s.lastSeen = 0;
    s.markSeen();
    const t = HistoryStore.fromJSON(JSON.parse(JSON.stringify(s.toJSON())), {now: () => NOW});
    assertEqual(t.records, s.records);
    assertEqual(t.lastSeen, NOW);
    assertEqual(t.toJSON().version, 1);
});
test('store: fromJSON throws on wrong version or shape', () => {
    assertThrows(() => HistoryStore.fromJSON({version: 2}, {now: () => 0}));
    assertThrows(() => HistoryStore.fromJSON(null, {now: () => 0}));
    assertThrows(() => HistoryStore.fromJSON({version: 1, lastSeen: 0, records: 'x'}, {now: () => 0}));
});
test('store: fromJSON drops invalid records', () => {
    const good = rec({id: 'good'});
    const s = HistoryStore.fromJSON({version: 1, lastSeen: 0, records: [
        {id: 'a'}, {id: 'b', title: 't', time: 'x'}, {title: 't', time: 1}, good,
    ]}, {now: () => 0});
    assertEqual(s.records, [good]);
});
test('fixtures: SAMPLE shape', () => {
    assertEqual(SAMPLE.length, 12);
    assertEqual(SAMPLE.filter(r => r.time > LAST_SEEN).length, 6);
    assertEqual(SAMPLE.filter(r => r.sessionId === 'old').length, 4);
});
test('store: a throwing subscriber does not stop others or the mutator', () => {
    const errors = [];
    const s = new HistoryStore({now: () => 1000, onError: e => errors.push(e)});
    let fired = 0;
    s.subscribe(() => {
        throw new Error('boom');
    });
    s.subscribe(() => fired++);
    s.add(rec({id: 'a'}));
    assertEqual(fired, 1);
    assertEqual(errors.length, 1);
    assertEqual(errors[0].message, 'boom');
    assertEqual(s.records.length, 1);
});
