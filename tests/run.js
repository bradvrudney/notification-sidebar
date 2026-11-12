import Gio from 'gi://Gio';
import System from 'system';
import {run} from './harness.js';

const dir = Gio.File.new_for_uri(import.meta.url).get_parent();
const names = [];
const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
let info;
while ((info = en.next_file(null)) !== null) {
    const n = info.get_name();
    if (n.endsWith('.test.js'))
        names.push(n);
}
names.sort();

for (const n of names)
    await import(`./${n}`);

const failures = run();
System.exit(failures > 0 ? 1 : 0);
