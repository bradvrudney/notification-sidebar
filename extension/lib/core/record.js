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

export function sameNotification(record, fields, sessionId) {
    return record.sessionId === sessionId &&
        record.appName === (fields.appName || 'Unknown') &&
        record.title === toPlainText(fields.title, false) &&
        record.body === toPlainText(fields.body, !!fields.isMarkup) &&
        record.time === fields.time;
}
