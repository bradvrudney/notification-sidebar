import GLib from 'gi://GLib';

export function at(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s);
    if (!m)
        throw new Error(`bad time: ${s}`);
    const [y, mo, d, h, mi] = m.slice(1).map(Number);
    return GLib.DateTime.new_utc(y, mo, d, h, mi, 0).to_unix();
}

let counter = 0;

export function rec(overrides = {}) {
    counter++;
    return {
        id: `r${counter}`,
        sessionId: 'cur',
        appId: 'org.example.App.desktop',
        appName: 'App',
        icon: null,
        title: `Title ${counter}`,
        body: `Body ${counter}`,
        time: 1000 + counter,
        urgency: 1,
        ...overrides,
    };
}

export const NOW = at('2026-11-12 14:40');
export const LAST_SEEN = at('2026-11-12 11:20');

const APPS = {
    Slack: 'com.slack.Slack.desktop',
    Thunderbird: 'org.mozilla.Thunderbird.desktop',
    Software: 'org.gnome.Software.desktop',
    Signal: 'org.signal.Signal.desktop',
    Files: 'org.gnome.Nautilus.desktop',
    Calendar: 'org.gnome.Calendar.desktop',
    Firefox: 'org.mozilla.firefox.desktop',
    Backups: 'org.gnome.DejaDup.desktop',
};

const RAW = [
    ['Slack', '2026-11-12 14:31', 'Dana Whitlock in #infra', 'Can you look at the staging deploy when you’re back? It’s stuck on migrations.'],
    ['Thunderbird', '2026-11-12 14:12', 'Invoice 2291 from Hetzner', 'Your invoice for November is now available.'],
    ['Thunderbird', '2026-11-12 13:48', 'Re: Q4 planning', 'Moved to Tuesday at 10. I’ll send a new invite this afternoon.'],
    ['Software', '2026-11-12 13:05', 'Updates ready to install', '14 updates, including kernel 7.2.16.'],
    ['Signal', '2026-11-12 12:40', 'Mom', 'Call me when you get a chance'],
    ['Files', '2026-11-12 11:52', 'Copy finished', '38 files copied to Backup-2026.'],
    ['Calendar', '2026-11-12 10:00', 'Standup in 10 minutes', 'Daily standup, 10:10 to 10:25'],
    ['Firefox', '2026-11-12 09:14', 'Download complete', 'Fedora-Everything-netinst-45.iso'],
    ['Backups', '2026-11-11 22:03', 'Backup finished', 'Home folder backed up to nas-01.'],
    ['Slack', '2026-11-11 17:25', 'Priya Raman', 'Merged your PR, thanks for the quick turnaround.'],
    ['Thunderbird', '2026-11-11 16:02', 'Your order has shipped', 'Arriving Friday.'],
    ['Thunderbird', '2026-11-11 15:40', 'Weekly digest', '12 new discussions in fedora-devel.'],
];

export const SAMPLE = RAW.map(([app, t, title, body], i) => {
    const time = at(t);
    return {
        id: `s${i + 1}`,
        sessionId: t.startsWith('2026-11-11') ? 'old' : 'cur',
        appId: APPS[app],
        appName: app,
        icon: null,
        title,
        body,
        time,
        urgency: 1,
    };
});
