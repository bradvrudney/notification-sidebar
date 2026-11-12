// Minimal test harness: test(), assertEqual (deep), assertTrue, assertThrows, run().
const tests = [];

export function test(name, fn) {
    tests.push({name, fn});
}

function deepEqual(a, b) {
    if (Object.is(a, b))
        return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    if (a instanceof Date || b instanceof Date)
        return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length)
        return false;
    return ka.every(k => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

function show(v) {
    try {
        return JSON.stringify(v);
    } catch (_e) {
        return String(v);
    }
}

export function assertEqual(actual, expected) {
    if (!deepEqual(actual, expected))
        throw new Error(`assertEqual failed: expected ${show(expected)}, got ${show(actual)}`);
}

export function assertTrue(v) {
    if (!v)
        throw new Error(`assertTrue failed: got ${show(v)}`);
}

export function assertThrows(fn) {
    let threw = false;
    try {
        fn();
    } catch (_e) {
        threw = true;
    }
    if (!threw)
        throw new Error('assertThrows failed: function did not throw');
}

// Runs fn (sync or async); resolves to null on success or the Error on failure.
export async function attempt(fn) {
    try {
        await fn();
        return null;
    } catch (e) {
        return e;
    }
}

export async function run() {
    let passed = 0;
    let failed = 0;
    for (const {name, fn} of tests) {
        const err = await attempt(fn);
        if (err === null) {
            passed++;
            print(`ok   ${name}`);
        } else {
            failed++;
            print(`FAIL ${name}: ${err.message}`);
        }
    }
    print(`${passed} passed, ${failed} failed`);
    return failed;
}
