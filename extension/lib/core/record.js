import {toPlainText} from './text.js';

export function makeRecord(fields, sessionId, newId) {
    return {
        id: newId(),
        sessionId,
        appId: fields.appId ?? null,
        appName: fields.appName || 'Unknown',
        icon: fields.icon ?? null,
        title: toPlainText(fields.title, false),
        body: toPlainText(fields.body, !!fields.isMarkup),
        time: fields.time,
        urgency: fields.urgency,
    };
}

function sameContent(record, fields) {
    return record.appName === (fields.appName || 'Unknown') &&
        record.title === toPlainText(fields.title, false) &&
        record.body === toPlainText(fields.body, !!fields.isMarkup) &&
        record.time === fields.time;
}

export function sameNotification(record, fields, sessionId) {
    return record.sessionId === sessionId && sameContent(record, fields);
}

// The record a newly seen notification belongs to, or null for a new one.
// Only records no live notification owns (`ownedIds`) are candidates, so
// identical notifications in the same second stay distinct records. First a
// same-session match (the notification was already recorded, for example
// before a disable/enable), then a previous-session one: the Shell restores
// GTK and portal notifications at login with their original time, and the
// caller adopts that record into the current session.
export function findRecordToLink(records, fields, sessionId, ownedIds) {
    const free = records.filter(r => !ownedIds.has(r.id) && sameContent(r, fields));
    return free.find(r => r.sessionId === sessionId) ?? free[0] ?? null;
}
