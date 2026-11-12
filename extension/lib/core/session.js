// Session identity. Pure: callers read the files and pass the text in.

// Field 22 of /proc/<pid>/stat (process start time, in clock ticks since
// boot), as a decimal string, or null if the text cannot be parsed. Field 2
// is the command name in parentheses and may itself contain spaces and
// parentheses, so fields are counted from the last ')'.
export function parseStartTime(statText) {
    if (typeof statText !== 'string')
        return null;
    const close = statText.lastIndexOf(')');
    if (close < 0)
        return null;
    // After ") ": field 3 (state) is index 0, so field 22 is index 19.
    const rest = statText.slice(close + 1).trim().split(/\s+/);
    const start = rest[19];
    return start !== undefined && /^\d+$/.test(start) ? start : null;
}

// Boot id plus the Shell process's start time: constant across
// disable/enable within one Shell process, new at every login. Without a
// readable start time, falls back to the login session id from the
// environment (which may be empty, so then it changes only at reboot).
export function composeSessionId(bootId, statText, xdgSessionId) {
    const start = parseStartTime(statText);
    if (start !== null)
        return `${bootId}:start-${start}`;
    return `${bootId}:session-${xdgSessionId ?? ''}`;
}
