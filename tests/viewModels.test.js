import {test, assertEqual, assertTrue} from './harness.js';
import {buildView, matches, timeText, dayHeading, VIEWS} from '../extension/lib/core/viewModels.js';
import {at, rec, SAMPLE, NOW, LAST_SEEN} from './fixtures.js';

const ctx = (over = {}) => ({now: NOW, lastSeen: LAST_SEEN, sessionId: 'cur',
    liveIds: new Set(), actionIds: new Set(), query: '', expanded: new Set(), ...over});
const kinds = vm => vm.items.map(i => i.kind === 'heading' ? `h:${i.text}` : i.kind);
const rep = (k, n) => Array(n).fill(k);
const groups = vm => vm.items.filter(i => i.kind === 'group');
const group = (vm, name) => groups(vm).find(g => g.appName === name);

test('VIEWS lists the three views', () => {
    assertEqual(VIEWS, ['timeline', 'by-app', 'new-then-history']);
});

// timeline
test('timeline: layout with new, earlier today, yesterday', () => {
    const vm = buildView('timeline', SAMPLE, ctx());
    assertEqual(vm.empty, null);
    assertEqual(kinds(vm), ['h:New since 11:20', ...rep('card', 6), 'h:Earlier today',
        ...rep('card', 2), 'h:Yesterday', ...rep('card', 4)]);
});
test('timeline: first and last card flags', () => {
    const {items} = buildView('timeline', SAMPLE, ctx());
    const first = items[1];
    assertEqual([first.isNew, first.isPrevious, first.timeText], [true, false, '14:31']);
    const last = items[items.length - 1];
    assertEqual([last.isNew, last.isPrevious], [false, true]);
    assertEqual(items[0].isNew, true);
    assertEqual(items.filter(i => i.kind === 'heading' && i.isNew).length, 1);
});
test('timeline: sorts defensively and does not mutate input', () => {
    const shuffled = [...SAMPLE].reverse();
    const vm = buildView('timeline', shuffled, ctx());
    assertEqual(vm.items[1].record.id, 's1');
    assertEqual(shuffled[0].id, 's12');
});
test('timeline: lastSeen 0 gives New heading only', () => {
    const vm = buildView('timeline', SAMPLE, ctx({lastSeen: 0}));
    assertEqual(kinds(vm), ['h:New', ...rep('card', 12)]);
});
test('timeline: lastSeen = now has no New section', () => {
    const vm = buildView('timeline', SAMPLE, ctx({lastSeen: NOW}));
    assertEqual(kinds(vm), ['h:Today', ...rep('card', 8), 'h:Yesterday', ...rep('card', 4)]);
});
test('timeline: lastSeen yesterday names the weekday', () => {
    const vm = buildView('timeline', SAMPLE, ctx({lastSeen: at('2026-11-11 16:30')}));
    assertEqual(vm.items[0].text, 'New since Wednesday 16:30');
});
test('timeline: older records get a dated heading', () => {
    const old = rec({time: at('2026-11-09 12:00')});
    const vm = buildView('timeline', [old], ctx());
    assertEqual(kinds(vm), ['h:Monday, November 9', 'card']);
});
test('timeline: isLive and hasActions come from ctx', () => {
    const vm = buildView('timeline', SAMPLE, ctx({liveIds: new Set(['s1']), actionIds: new Set(['s2'])}));
    assertEqual([vm.items[1].isLive, vm.items[1].hasActions], [true, false]);
    assertEqual([vm.items[2].isLive, vm.items[2].hasActions], [false, true]);
});

// new-then-history
test('new-then-history: layout', () => {
    const vm = buildView('new-then-history', SAMPLE, ctx());
    assertEqual(kinds(vm), ['h:New since 11:20', ...rep('card', 3), 'more', 'h:Earlier today',
        ...rep('line', 2), 'h:Yesterday', ...rep('line', 4)]);
    const more = vm.items.find(i => i.kind === 'more');
    assertEqual([more.text, more.key], ['Show 3 more new', 'new']);
});
test('new-then-history: expanded new shows all new cards', () => {
    const vm = buildView('new-then-history', SAMPLE, ctx({expanded: new Set(['new'])}));
    assertEqual(kinds(vm).slice(0, 8), ['h:New since 11:20', ...rep('card', 6), 'h:Earlier today']);
    assertTrue(!kinds(vm).includes('more'));
});
test('new-then-history: seen record with actions is a card', () => {
    const vm = buildView('new-then-history', SAMPLE, ctx({actionIds: new Set(['s9'])}));
    const item = vm.items.find(i => i.record && i.record.id === 's9');
    assertEqual([item.kind, item.hasActions], ['card', true]);
    assertEqual(vm.items.find(i => i.record && i.record.id === 's10').kind, 'line');
});
test('new-then-history: no new records means no New heading and Today', () => {
    const vm = buildView('new-then-history', SAMPLE, ctx({lastSeen: NOW}));
    assertEqual(kinds(vm)[0], 'h:Today');
});

// by-app
const TB = 'org.mozilla.Thunderbird.desktop';
test('by-app: group order', () => {
    const vm = buildView('by-app', SAMPLE, ctx());
    assertEqual(groups(vm).map(g => g.appName), ['Slack', 'Thunderbird', 'Software', 'Signal',
        'Files', 'Calendar', 'Firefox', 'Backups']);
    assertEqual(vm.items.length, 8);
});
test('by-app: Thunderbird group', () => {
    const g = group(buildView('by-app', SAMPLE, ctx()), 'Thunderbird');
    assertEqual([g.key, g.newCount], [TB, 2]);
    assertEqual(g.rows.map(r => r.kind), ['line', 'line', 'more']);
    assertEqual(g.rows[2].text, 'Show 2 earlier');
    assertEqual(g.rows[2].key, `group:${TB}`);
    assertEqual(g.rows[0].record.id, 's2');
});
test('by-app: Calendar and Backups', () => {
    const vm = buildView('by-app', SAMPLE, ctx());
    const cal = group(vm, 'Calendar');
    assertEqual([cal.newCount, cal.rows.map(r => r.kind), cal.timeText], [0, ['line'], '10:00']);
    assertEqual(group(vm, 'Backups').timeText, 'Yesterday');
});
test('by-app: older day shows short date', () => {
    const vm = buildView('by-app', [rec({time: at('2026-11-09 12:00')})], ctx());
    assertEqual(vm.items[0].timeText, 'Nov 9');
});
test('by-app: expanded group shows every row', () => {
    const vm = buildView('by-app', SAMPLE, ctx({expanded: new Set([`group:${TB}`])}));
    const g = group(vm, 'Thunderbird');
    assertEqual(g.rows.map(r => r.kind), ['line', 'line', 'line', 'line']);
});
test('by-app: hasActions rows are cards in time order and not counted as hidden', () => {
    const vm = buildView('by-app', SAMPLE, ctx({actionIds: new Set(['s11'])}));
    const g = group(vm, 'Thunderbird');
    assertEqual(g.rows.map(r => r.kind), ['line', 'line', 'card', 'more']);
    assertEqual(g.rows[2].record.id, 's11');
    assertEqual(g.rows[3].text, 'Show 1 earlier');
});
test('by-app: no headings and appId null groups by name', () => {
    const a = rec({appId: null, appName: 'notify-send', time: at('2026-11-12 14:00')});
    const b = rec({appId: null, appName: 'notify-send', time: at('2026-11-12 13:00')});
    const vm = buildView('by-app', [a, b], ctx());
    assertEqual(vm.items.length, 1);
    assertEqual(vm.items[0].key, 'name:notify-send');
    assertEqual(vm.items[0].rows.length, 2);
});

// search
test('search: query filters in every view', () => {
    for (const v of VIEWS) {
        const vm = buildView(v, SAMPLE, ctx({query: 'HETZNER'}));
        const recs = vm.items.flatMap(i => i.kind === 'group'
            ? i.rows.filter(r => r.record).map(r => r.record) : i.record ? [i.record] : []);
        assertEqual(recs.map(r => r.id), ['s2']);
    }
});
test('search: no match and no records', () => {
    for (const v of VIEWS) {
        assertEqual(buildView(v, SAMPLE, ctx({query: 'zzz'})), {empty: 'no-match', items: []});
        assertEqual(buildView(v, [], ctx()), {empty: 'none', items: []});
    }
});
test('matches: case-insensitive on app, title, body; blank matches all', () => {
    const r = rec({appName: 'Slack', title: 'Hello', body: 'World'});
    assertTrue(matches(r, 'slack'));
    assertTrue(matches(r, 'HELLO'));
    assertTrue(matches(r, 'orl'));
    assertTrue(!matches(r, 'nope'));
    assertTrue(matches(r, ''));
    assertTrue(matches(r, '   '));
});

// paging
const many = n => Array.from({length: n}, (_, i) => rec({time: at('2026-11-11 08:00') + i}));
test('paging: timeline stops at 200 and appends more', () => {
    const vm = buildView('timeline', many(250), ctx());
    const cards = vm.items.filter(i => i.kind === 'card');
    assertEqual(cards.length, 200);
    assertEqual(vm.items[vm.items.length - 1], {kind: 'more', key: 'page', text: 'Show more'});
});
test('paging: expanded page ignores the limit', () => {
    const vm = buildView('timeline', many(250), ctx({expanded: new Set(['page'])}));
    assertEqual(vm.items.filter(i => i.kind === 'card').length, 250);
    assertTrue(!kinds(vm).includes('more'));
});
test('paging: exactly the limit has no more item', () => {
    const vm = buildView('timeline', many(5), ctx({limit: 5}));
    assertTrue(!kinds(vm).includes('more'));
});
test('paging: by-app truncates a group and stops', () => {
    const recs = [
        ...Array.from({length: 4}, (_, i) => rec({appId: 'a', appName: 'A', time: at('2026-11-12 14:00') - i})),
        rec({appId: 'b', appName: 'B', time: at('2026-11-12 12:00')}),
    ];
    const vm = buildView('by-app', recs, ctx({limit: 3}));
    assertEqual(kinds(vm), ['group', 'more']);
    assertEqual(vm.items[0].rows.length, 3);
    assertEqual(vm.items[1].key, 'page');
});
test('paging: by-app stops before the next group once the limit is met', () => {
    const recs = [rec({appId: 'a', appName: 'A', time: at('2026-11-12 14:00')}),
        rec({appId: 'b', appName: 'B', time: at('2026-11-12 12:00')})];
    const vm = buildView('by-app', recs, ctx({limit: 1}));
    assertEqual(kinds(vm), ['group', 'more']);
});
test('paging: new-then-history applies the limit to seen lines', () => {
    const vm = buildView('new-then-history', many(10), ctx({limit: 4}));
    assertEqual(vm.items.filter(i => i.kind === 'line').length, 4);
    assertEqual(vm.items[vm.items.length - 1].key, 'page');
});

// time
test('timeText is local HH:MM (TZ=UTC under make test)', () => {
    assertEqual(timeText(at('2026-11-12 09:05'), NOW), '09:05');
});
test('dayHeading variants', () => {
    assertEqual(dayHeading(at('2026-11-12 09:05'), NOW, false), 'Today');
    assertEqual(dayHeading(at('2026-11-12 09:05'), NOW, true), 'Earlier today');
    assertEqual(dayHeading(at('2026-11-11 23:59'), NOW, true), 'Yesterday');
    assertEqual(dayHeading(at('2026-11-10 12:00'), NOW, false), 'Tuesday, November 10');
});
