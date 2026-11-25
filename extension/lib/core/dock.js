// Where the panel goes, and when a docked panel counts as looked at. Pure:
// no Shell imports, all sizes in physical pixels.

export const PANEL_WIDTH = 344;
export const MARGIN = 6;

// A docked panel is taken as looked at once the pointer has been over it,
// in use, for this long; a pointer that only crosses it does not count.
export const LOOK_MS = 1000;

// With no pointer activity over the panel for this long the pointer is
// taken as parked there, not in use: whatever came before no longer counts.
export const IDLE_MS = 30000;

// `monitor` is {x, y, width, height}. Returns the panel's box (`card`) and
// the strip a docked panel reserves (`strip`): the card plus a margin each
// side, the full height of the monitor, against its right edge.
export function panelGeometry({monitor, topBarHeight, scale}) {
    const width = PANEL_WIDTH * scale;
    const margin = MARGIN * scale;
    const right = monitor.x + monitor.width;
    const top = monitor.y + topBarHeight + margin;
    const stripWidth = Math.min(width + 2 * margin, monitor.width);
    return {
        card: {
            x: right - width - margin,
            y: top,
            width,
            height: Math.max(0, monitor.y + monitor.height - margin - top),
        },
        strip: {
            x: right - stripWidth,
            y: monitor.y,
            width: stripWidth,
            height: monitor.height,
        },
    };
}

// Decides, from pointer activity over a docked panel, whether it has been
// looked at. Times are in milliseconds on any steady clock.
export class LookTracker {
    constructor({lookMs = LOOK_MS, idleMs = IDLE_MS} = {}) {
        this.lookMs = lookMs;
        this.idleMs = idleMs;
        this.reset();
    }

    reset() {
        this._since = null;
        this._last = null;
    }

    // The pointer came over the panel, or moved, scrolled or pressed on it.
    activity(ms) {
        if (this._last === null || ms - this._last > this.idleMs)
            this._since = ms;
        this._last = ms;
    }

    // The pointer left the panel. True when the visit counts as a look: it
    // was in use up to now, and had been for at least `lookMs`.
    leave(ms) {
        const looked = this._last !== null &&
            ms - this._last <= this.idleMs && ms - this._since >= this.lookMs;
        this.reset();
        return looked;
    }
}
