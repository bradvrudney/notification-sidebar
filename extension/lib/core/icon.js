// Serialised GIcon strings (Gio.Icon.to_string). Pure: no Gio calls here.
//
// Gio.icon_new_for_string() crashes the process (it cannot be caught) on a
// themed-icon form with no names, such as ". GThemedIcon". The history file
// and app-supplied icons are not trusted, so every string is checked first.

// Tokenised forms are ". <Type> <token> ...", tokens URI-escaped; a nested
// icon (an emblemed icon's base and emblems) is one escaped token that is
// itself a full icon string.
function tokensSafe(s, depth) {
    if (depth > 4)
        return false;
    const tokens = s.split(' ');
    if (tokens.some(t => t === ''))
        return false;
    const [, type, ...rest] = tokens;
    if (type === 'GThemedIcon')
        return rest.length > 0;
    for (const token of rest) {
        let inner;
        try {
            inner = decodeURIComponent(token);
        } catch (_e) {
            return false;
        }
        if (inner.startsWith('.') && !tokensSafe(inner, depth + 1))
            return false;
    }
    return true;
}

// True if `s` may be passed to Gio.icon_new_for_string().
export function isSafeIconString(s) {
    if (typeof s !== 'string' || s.trim() === '')
        return false;
    if (s.startsWith('.'))
        return tokensSafe(s, 0);
    return true;
}
