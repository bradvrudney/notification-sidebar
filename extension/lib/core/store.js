const DAY = 86400;
// 2100-01-01T00:00:00Z. Well inside what GLib.DateTime can represent, so a
// stored time can always be formatted.
const MAX_TIME = 4102444800;

function validRecord(r) {
    return r !== null && typeof r === 'object' &&
        typeof r.id === 'string' && typeof r.title === 'string' &&
        typeof r.time === 'number' && Number.isFinite(r.time) &&
        r.time >= 0 && r.time <= MAX_TIME;
}

export class HistoryStore {
    constructor({now, retentionDays = 7, maxRecords = 2000,
        onError = e => console.error(`HistoryStore subscriber failed: ${e}`)}) {
        this._now = now;
        this._onError = onError;
        this._retentionDays = retentionDays;
        this._maxRecords = maxRecords;
        this._entries = [];   // {rec, seq}
        this._seq = 0;
        this._subs = new Set();
        this.lastSeen = 0;
    }

    _sorted() {
        return [...this._entries].sort((a, b) => b.rec.time - a.rec.time || b.seq - a.seq);
    }

    get records() {
        return this._sorted().map(e => e.rec);
    }

    _notify() {
        for (const fn of [...this._subs]) {
            try {
                fn();
            } catch (e) {
                this._onError(e);
            }
        }
    }

    _trim() {
        if (this._entries.length <= this._maxRecords)
            return 0;
        const keep = this._sorted().slice(0, this._maxRecords);
        const removed = this._entries.length - keep.length;
        this._entries = keep;
        return removed;
    }

    _insert(record) {
        this._entries.push({rec: record, seq: this._seq++});
    }

    add(record) {
        this._insert(record);
        this._trim();
        this._notify();
    }

    update(id, patch) {
        const e = this._entries.find(x => x.rec.id === id);
        if (!e)
            return false;
        Object.assign(e.rec, patch);
        this._notify();
        return true;
    }

    remove(id) {
        const i = this._entries.findIndex(x => x.rec.id === id);
        if (i < 0)
            return false;
        this._entries.splice(i, 1);
        this._notify();
        return true;
    }

    clear() {
        this._entries = [];
        this._notify();
    }

    get(id) {
        return this._entries.find(x => x.rec.id === id)?.rec ?? null;
    }

    markSeen() {
        this.lastSeen = this._now();
        this._notify();
    }

    newCount() {
        return this._entries.filter(e => e.rec.time > this.lastSeen).length;
    }

    prune() {
        const cutoff = this._now() - this._retentionDays * DAY;
        const before = this._entries.length;
        this._entries = this._entries.filter(e => !(e.rec.time < cutoff));
        this._trim();
        const removed = before - this._entries.length;
        if (removed > 0)
            this._notify();
        return removed;
    }

    setRetentionDays(n) {
        this._retentionDays = n;
        this.prune();
    }

    subscribe(fn) {
        this._subs.add(fn);
        return () => this._subs.delete(fn);
    }

    toJSON() {
        return {version: 1, lastSeen: this.lastSeen, records: this.records};
    }

    static fromJSON(obj, opts) {
        if (obj === null || typeof obj !== 'object' || obj.version !== 1 ||
            !Array.isArray(obj.records))
            throw new Error('Invalid history file');
        const store = new HistoryStore(opts);
        store.lastSeen = typeof obj.lastSeen === 'number' ? obj.lastSeen : 0;
        // records are stored newest first; insert oldest first so ties keep order
        for (const r of [...obj.records].reverse()) {
            if (validRecord(r))
                store._insert(r);
        }
        return store;
    }
}
