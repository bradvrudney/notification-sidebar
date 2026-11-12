import GLib from 'gi://GLib';

export const VIEWS = ['timeline', 'by-app', 'new-then-history'];

const NEW_PREVIEW = 3;
const DEFAULT_LIMIT = 200;

const local = time => GLib.DateTime.new_from_unix_local(time);
const dayKey = dt => `${dt.get_year()}-${dt.get_month()}-${dt.get_day_of_month()}`;

function dayRelation(time, now) {
    const key = dayKey(local(time));
    const today = local(now);
    if (key === dayKey(today))
        return 'today';
    if (key === dayKey(today.add_days(-1)))
        return 'yesterday';
    return 'older';
}

export function matches(record, query) {
    const q = (query ?? '').trim().toLowerCase();
    if (q === '')
        return true;
    return [record.appName, record.title, record.body]
        .some(f => typeof f === 'string' && f.toLowerCase().includes(q));
}

export function timeText(time, _now) {
    return local(time).format('%H:%M');
}

export function dayHeading(time, now, hasNewSection) {
    switch (dayRelation(time, now)) {
    case 'today':
        return hasNewSection ? 'Earlier today' : 'Today';
    case 'yesterday':
        return 'Yesterday';
    default:
        return local(time).format('%A, %B %-e');
    }
}

function newHeadingText(ctx) {
    if (ctx.lastSeen === 0)
        return 'New';
    if (dayRelation(ctx.lastSeen, ctx.now) === 'today')
        return `New since ${timeText(ctx.lastSeen, ctx.now)}`;
    return `New since ${local(ctx.lastSeen).format('%A')} ${timeText(ctx.lastSeen, ctx.now)}`;
}

function groupTimeText(time, now) {
    switch (dayRelation(time, now)) {
    case 'today':
        return timeText(time, now);
    case 'yesterday':
        return 'Yesterday';
    default:
        return local(time).format('%b %-e');
    }
}

function makeRow(kind, record, ctx) {
    return {
        kind,
        record,
        timeText: timeText(record.time, ctx.now),
        isNew: record.time > ctx.lastSeen,
        isPrevious: record.sessionId !== ctx.sessionId,
        isLive: ctx.liveIds.has(record.id),
        hasActions: ctx.actionIds.has(record.id),
    };
}

// Entries: {heading, isNew} | {row: kind, record} | {more: item}.
// Applies the paging limit to the row entries; headings appear only if a row follows.
function paginate(entries, ctx, limit) {
    const paged = !ctx.expanded.has('page');
    const items = [];
    let pending = null;
    let count = 0;
    for (const e of entries) {
        if (e.heading !== undefined) {
            pending = {kind: 'heading', text: e.heading, isNew: e.isNew};
        } else if (e.more) {
            items.push(e.more);
        } else {
            if (paged && count >= limit) {
                items.push({kind: 'more', key: 'page', text: 'Show more'});
                return items;
            }
            if (pending) {
                items.push(pending);
                pending = null;
            }
            items.push(makeRow(e.row, e.record, ctx));
            count++;
        }
    }
    return items;
}

function seenEntries(seen, ctx, hasNew, rowKind) {
    const entries = [];
    let lastDay = null;
    for (const r of seen) {
        const key = dayKey(local(r.time));
        if (key !== lastDay) {
            entries.push({heading: dayHeading(r.time, ctx.now, hasNew), isNew: false});
            lastDay = key;
        }
        entries.push({row: rowKind(r), record: r});
    }
    return entries;
}

function timeline(records, ctx, limit) {
    const news = records.filter(r => r.time > ctx.lastSeen);
    const seen = records.filter(r => r.time <= ctx.lastSeen);
    const entries = [];
    if (news.length) {
        entries.push({heading: newHeadingText(ctx), isNew: true});
        news.forEach(r => entries.push({row: 'card', record: r}));
    }
    entries.push(...seenEntries(seen, ctx, news.length > 0, () => 'card'));
    return paginate(entries, ctx, limit);
}

function newThenHistory(records, ctx, limit) {
    const news = records.filter(r => r.time > ctx.lastSeen);
    const seen = records.filter(r => r.time <= ctx.lastSeen);
    const entries = [];
    if (news.length) {
        entries.push({heading: newHeadingText(ctx), isNew: true});
        const showAll = ctx.expanded.has('new');
        const shown = showAll ? news : news.slice(0, NEW_PREVIEW);
        shown.forEach(r => entries.push({row: 'card', record: r}));
        if (shown.length < news.length) {
            entries.push({more: {
                kind: 'more', key: 'new', text: `Show ${news.length - shown.length} more new`,
            }});
        }
    }
    entries.push(...seenEntries(seen, ctx, news.length > 0,
        r => ctx.actionIds.has(r.id) ? 'card' : 'line'));
    return paginate(entries, ctx, limit);
}

function byApp(records, ctx, limit) {
    const paged = !ctx.expanded.has('page');
    const groups = new Map();
    for (const r of records) {
        const key = r.appId ?? `name:${r.appName}`;
        if (!groups.has(key))
            groups.set(key, []);
        groups.get(key).push(r);
    }

    const items = [];
    let count = 0;
    for (const [key, recs] of groups) {
        if (paged && count >= limit) {
            items.push({kind: 'more', key: 'page', text: 'Show more'});
            return items;
        }
        const newest = recs[0];
        const newCount = recs.filter(r => r.time > ctx.lastSeen).length;
        const expanded = ctx.expanded.has(`group:${key}`);
        const base = new Set(newCount ? recs.filter(r => r.time > ctx.lastSeen) : [newest]);
        const shown = recs.filter(r => expanded || base.has(r) || ctx.actionIds.has(r.id));
        const hidden = recs.length - shown.length;

        const room = paged ? limit - count : Infinity;
        const truncated = shown.length > room;
        const rows = shown.slice(0, room).map(r =>
            makeRow(ctx.actionIds.has(r.id) ? 'card' : 'line', r, ctx));
        count += rows.length;
        if (hidden > 0 && !truncated) {
            rows.push({kind: 'more', key: `group:${key}`, text: `Show ${hidden} earlier`});
        }
        items.push({
            kind: 'group',
            key,
            appName: newest.appName,
            icon: newest.icon,
            newCount,
            timeText: groupTimeText(newest.time, ctx.now),
            rows,
        });
        if (truncated) {
            items.push({kind: 'more', key: 'page', text: 'Show more'});
            return items;
        }
    }
    return items;
}

export function buildView(view, records, ctx) {
    if (!VIEWS.includes(view))
        throw new Error(`unknown view: ${view}`);
    if (records.length === 0)
        return {empty: 'none', items: []};
    const filtered = records
        .filter(r => matches(r, ctx.query))
        .sort((a, b) => b.time - a.time);
    if (filtered.length === 0)
        return {empty: 'no-match', items: []};

    const limit = ctx.limit ?? DEFAULT_LIMIT;
    const build = {timeline, 'by-app': byApp, 'new-then-history': newThenHistory}[view];
    return {empty: null, items: build(filtered, ctx, limit)};
}
