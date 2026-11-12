import {test, assertEqual} from './harness.js';
import {toPlainText} from '../extension/lib/core/text.js';

test('text: strips tags and decodes entities when markup', () => {
    assertEqual(toPlainText('<b>Hi</b> &amp; bye', true), 'Hi & bye');
});
test('text: leaves markup alone when not markup', () => {
    assertEqual(toPlainText('<b>Hi</b> &amp; bye', false), '<b>Hi</b> &amp; bye');
});
test('text: collapses whitespace and trims', () => {
    assertEqual(toPlainText('a\n\n  b\tc ', false), 'a b c');
});
test('text: null becomes empty string', () => {
    assertEqual(toPlainText(null, true), '');
});
test('text: truncates to 2000 characters', () => {
    assertEqual(toPlainText('x'.repeat(5000), false).length, 2000);
});
test('text: unclosed < is kept and never throws', () => {
    assertEqual(toPlainText('<unclosed & stray', true), '<unclosed & stray');
});
test('text: decodes all named and numeric entities', () => {
    assertEqual(toPlainText('&lt;&gt;&quot;&apos;&#65;', true), '<>"\'A');
});
