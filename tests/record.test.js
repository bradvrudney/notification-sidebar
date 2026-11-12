import {test, assertEqual, assertTrue} from './harness.js';
import {makeRecord, sameNotification} from '../extension/lib/core/record.js';

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
