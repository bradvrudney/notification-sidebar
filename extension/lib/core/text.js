const MAX_LENGTH = 2000;

const NAMED = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'"};

function decodeEntities(s) {
    return s.replace(/&(?:(amp|lt|gt|quot|apos)|#(\d+));/g, (m, name, num) => {
        if (name)
            return NAMED[name];
        const cp = Number(num);
        if (cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff))
            return String.fromCodePoint(cp);
        return m;
    });
}

export function toPlainText(text, isMarkup) {
    if (text === null || text === undefined)
        return '';
    let s = String(text);
    if (isMarkup)
        s = decodeEntities(s.replace(/<[^<>]*>/g, ''));
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > MAX_LENGTH ? s.slice(0, MAX_LENGTH) : s;
}
