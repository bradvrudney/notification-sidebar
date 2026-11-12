import {test, assertEqual, assertTrue} from './harness.js';
import {makeRecord, sameNotification, findRecordToLink} from '../extension/lib/core/record.js';

const fields = {appId: null, appName: '', icon: null, title: 'T\n1', body: '<i>b</i>',
    isMarkup: true, time: 100, urgency: 1};

test('record: makeRecord normalises fields', () => {
    assertEqual(makeRecord(fields, 'cur', () => 'id1'),
        {id: 'id1', sessionId: 'cur', appId: null, appName: 'Unknown', icon: null,
            title: 'T 1', body: 'b', time: 100, urgency: 1});
});
test('record: sameNotification matches on plain text and session', () => {
    const r = makeRecord(fields, 'cur', () => 'id1');
    assertTrue(sameNotification(r, {appName: '', title: 'T\n1', body: '<i>b</i>',
        isMarkup: true, time: 100}, 'cur'));
});
test('record: sameNotification is false for another session', () => {
    const r = makeRecord(fields, 'cur', () => 'id1');
    assertTrue(!sameNotification(r, {appName: '', title: 'T 1', body: 'b', time: 100}, 'other'));
});
test('record: sameNotification is false for different time', () => {
    const r = makeRecord(fields, 'cur', () => 'id1');
    assertTrue(!sameNotification(r, {appName: '', title: 'T 1', body: 'b', time: 101}, 'cur'));
});

const n = (over = {}) => ({appName: 'App', title: 'T', body: 'B', isMarkup: false, time: 100, ...over});
const stored = (id, sessionId, over = {}) =>
    makeRecord(n(over), sessionId, () => id);

test('link: same-session unowned match is linked', () => {
    const recs = [stored('a', 'cur')];
    assertEqual(findRecordToLink(recs, n(), 'cur', new Set())?.id, 'a');
});
test('link: same-session match is preferred over a previous-session one', () => {
    const recs = [stored('old', 'prev'), stored('a', 'cur')];
    assertEqual(findRecordToLink(recs, n(), 'cur', new Set())?.id, 'a');
});
test('link: previous-session match is returned for adoption', () => {
    const recs = [stored('old', 'prev'), stored('other', 'prev', {title: 'U'})];
    const r = findRecordToLink(recs, n(), 'cur', new Set());
    assertEqual(r?.id, 'old');
    assertEqual(r.sessionId, 'prev');
});
test('link: previous-session match compares plain title and body', () => {
    const recs = [stored('old', 'prev', {body: '<i>B</i>', isMarkup: true})];
    assertEqual(findRecordToLink(recs, n({body: '<i>B</i>', isMarkup: true}), 'cur', new Set())?.id,
        'old');
});
test('link: same-second twins in one session get two records', () => {
    const recs = [stored('a', 'cur')];
    const owned = new Set();
    const first = findRecordToLink(recs, n(), 'cur', owned);
    assertEqual(first?.id, 'a');
    owned.add(first.id);
    assertEqual(findRecordToLink(recs, n(), 'cur', owned), null);
});
test('link: two identical previous-session records link one each', () => {
    const recs = [stored('p1', 'prev'), stored('p2', 'prev')];
    const owned = new Set();
    const first = findRecordToLink(recs, n(), 'cur', owned);
    assertTrue(first !== null);
    owned.add(first.id);
    first.sessionId = 'cur';   // adopted
    const second = findRecordToLink(recs, n(), 'cur', owned);
    assertTrue(second !== null && second.id !== first.id);
    owned.add(second.id);
    assertEqual(findRecordToLink(recs, n(), 'cur', owned), null);
});
test('link: no match returns null', () => {
    const recs = [stored('a', 'cur'), stored('b', 'prev')];
    assertEqual(findRecordToLink(recs, n({time: 101}), 'cur', new Set()), null);
    assertEqual(findRecordToLink(recs, n({appName: 'Other'}), 'cur', new Set()), null);
    assertEqual(findRecordToLink([], n(), 'cur', new Set()), null);
});
