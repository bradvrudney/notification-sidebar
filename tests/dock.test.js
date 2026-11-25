import {test, assertEqual} from './harness.js';
import {
    panelGeometry, LookTracker, PANEL_WIDTH, MARGIN, LOOK_MS, IDLE_MS,
} from '../extension/lib/core/dock.js';
import {dayKeyOf} from '../extension/lib/core/viewModels.js';

test('dock: card sits under the top bar, inset from the right and bottom edges', () => {
    const g = panelGeometry({
        monitor: {x: 0, y: 0, width: 1280, height: 800}, topBarHeight: 32, scale: 1,
    });
    assertEqual(g.card, {x: 1280 - PANEL_WIDTH - MARGIN, y: 32 + MARGIN, width: PANEL_WIDTH,
        height: 800 - MARGIN - (32 + MARGIN)});
    assertEqual(g.card, {x: 930, y: 38, width: 344, height: 756});
});

test('dock: reserved strip is the card plus a margin each side, full monitor height, on the right edge', () => {
    const g = panelGeometry({
        monitor: {x: 0, y: 0, width: 1280, height: 800}, topBarHeight: 32, scale: 1,
    });
    assertEqual(g.strip, {x: 924, y: 0, width: 356, height: 800});
    // Touches the right edge and spans top to bottom: what the Shell needs
    // to call it a right-hand strut.
    assertEqual(g.strip.x + g.strip.width, 1280);
});

test('dock: scales with the UI scale factor and follows the monitor origin', () => {
    const g = panelGeometry({
        monitor: {x: 1920, y: 100, width: 3840, height: 2160}, topBarHeight: 64, scale: 2,
    });
    assertEqual(g.card, {x: 5060, y: 176, width: 688, height: 2072});
    assertEqual(g.strip, {x: 5048, y: 100, width: 712, height: 2160});
});

test('dock: no top bar', () => {
    const g = panelGeometry({
        monitor: {x: 0, y: 0, width: 1280, height: 800}, topBarHeight: 0, scale: 1,
    });
    assertEqual(g.card.y, MARGIN);
    assertEqual(g.card.height, 800 - 2 * MARGIN);
});

test('dock: strip never exceeds the monitor; card height never negative', () => {
    const g = panelGeometry({
        monitor: {x: 50, y: 0, width: 300, height: 20}, topBarHeight: 32, scale: 1,
    });
    assertEqual(g.strip, {x: 50, y: 0, width: 300, height: 20});
    assertEqual(g.card.height, 0);
});

test('look: leaving without ever being over the panel is not a look', () => {
    assertEqual(new LookTracker().leave(5000), false);
});

test('look: a pointer that only crosses the panel is not a look', () => {
    const t = new LookTracker();
    t.activity(1000);
    t.activity(1200);
    assertEqual(t.leave(1000 + LOOK_MS - 1), false);
});

test('look: resting on the panel for LOOK_MS, then leaving, is a look', () => {
    const t = new LookTracker();
    t.activity(1000);
    assertEqual(t.leave(1000 + LOOK_MS), true);
});

test('look: moving about in the panel keeps one look going', () => {
    const t = new LookTracker();
    for (let ms = 0; ms <= 3 * IDLE_MS; ms += IDLE_MS / 2)
        t.activity(ms);
    assertEqual(t.leave(3 * IDLE_MS + 10), true);
});

test('look: a pointer left parked on the panel, then moved away, is not a look', () => {
    const t = new LookTracker();
    t.activity(1000);
    // Nothing for longer than IDLE_MS; then the movement that takes it out.
    const back = 1000 + IDLE_MS + 60000;
    t.activity(back);
    t.activity(back + 150);
    assertEqual(t.leave(back + 300), false);
});

test('look: parked, then left with no movement inside first, is not a look', () => {
    const t = new LookTracker();
    t.activity(1000);
    assertEqual(t.leave(1000 + IDLE_MS + 1), false);
});

test('look: coming back after being parked and staying is a look again', () => {
    const t = new LookTracker();
    t.activity(1000);
    const back = 1000 + IDLE_MS + 60000;
    t.activity(back);
    t.activity(back + LOOK_MS / 2);
    assertEqual(t.leave(back + LOOK_MS), true);
});

test('look: each visit is judged on its own', () => {
    const t = new LookTracker();
    t.activity(0);
    assertEqual(t.leave(LOOK_MS), true);
    t.activity(LOOK_MS + 100);
    assertEqual(t.leave(LOOK_MS + 200), false);
    assertEqual(t.leave(LOOK_MS + 5000), false);
});

test('viewModels: dayKeyOf changes at local midnight only', () => {
    assertEqual(dayKeyOf(0), '1970-1-1');
    assertEqual(dayKeyOf(86399), dayKeyOf(0));
    assertEqual(dayKeyOf(86400), '1970-1-2');
});
