/**
 * Tests for composer-logic.ts — pure functions, no DOM/React needed
 *
 * Run: npx tsx src/composer-logic.test.ts
 *
 * Тестирует весь пайплайн: normalizeText → validatePost → buildPostInput
 * Покрывает: вставка кода, двойные переносы, отступы, CRLF, валидация, basename
 */

import {
  normalizeText,
  normalizePastedText,
  validatePost,
  buildPostInput,
  insertTextAt,
} from './composer-logic';
import type { ComposerInput } from './composer-logic';

let passed = 0;
let failed = 0;
const errors: string[] = [];

function assert(condition: boolean, name: string, detail?: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    const msg = `FAIL: ${name}${detail ? ' — ' + detail : ''}`;
    errors.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

function eq(actual: any, expected: any, name: string) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  assert(a === e, name, a !== e ? `got ${a}, expected ${e}` : undefined);
}

/* ============================================================
 * normalizeText
 * ============================================================ */

console.log('\n=== normalizeText ===');

// 1. Normal code block — no changes
eq(
  normalizeText('```python\ndef greet():\n    pass\n```'),
  '```python\ndef greet():\n    pass\n```',
  'normal code block unchanged',
);

// 2. Double blank lines inside code fence → collapse
eq(
  normalizeText('```python\n\n\n\ndef greet():\n\n\n\n    pass\n\n\n\n```'),
  '```python\ndef greet():\n\n    pass\n```',
  'collapses 3+ blank lines to 1 inside code fence',
);

// 3. Leading/trailing blank lines inside code fence → removed
eq(
  normalizeText('```js\n\n\nconst x = 1;\n\n\n```'),
  '```js\nconst x = 1;\n```',
  'removes leading/trailing blank lines inside fence',
);

// 4. Dedent common whitespace
eq(
  normalizeText('```python\n  def greet():\n      pass\n```'),
  '```python\ndef greet():\n    pass\n```',
  'dedents 2-space common indent',
);

// 5. Indented closing fence
eq(
  normalizeText('```python\n  def greet():\n      pass\n  ```'),
  '```python\ndef greet():\n    pass\n```',
  'fixes indented closing fence',
);

// 6. User's actual broken input
eq(
  normalizeText('```python\n\n  def greet(name):\n\n      return f"ok"\n\n\n\n  print(greet("мир"))\n\n```'),
  '```python\ndef greet(name):\n\n    return f"ok"\n\nprint(greet("мир"))\n```',
  'fixes user\'s actual broken paste',
);

// 7. CRLF → LF
eq(
  normalizeText('```python\r\ndef greet():\r\n    pass\r\n```'),
  '```python\ndef greet():\n    pass\n```',
  'converts CRLF to LF',
);

// 8. Text without code blocks — minimal changes
eq(
  normalizeText('Hello\r\nWorld'),
  'Hello\nWorld',
  'plain text: only line ending normalization',
);

// 9. Multiple code blocks
eq(
  normalizeText('text\n\n```js\n  const a = 1;\n```\n\nmiddle\n\n```py\n  x = 1\n```'),
  'text\n\n```js\nconst a = 1;\n```\n\nmiddle\n\n```py\nx = 1\n```',
  'normalizes multiple code blocks independently',
);

// 10. Preserves intentional single blank line
eq(
  normalizeText('```js\nconst a = 1;\n\nconst b = 2;\n```'),
  '```js\nconst a = 1;\n\nconst b = 2;\n```',
  'preserves single intentional blank line',
);

// 11. No indentation to strip (some lines start at column 0)
eq(
  normalizeText('```py\ndef a():\n    pass\n```'),
  '```py\ndef a():\n    pass\n```',
  'no dedent when min indent is 0',
);

// 12. Code fence with language tag containing numbers
eq(
  normalizeText('```python3\n  x = 1\n```'),
  '```python3\nx = 1\n```',
  'handles language tag with digits',
);

/* ============================================================
 * normalizePastedText
 * ============================================================ */

console.log('\n=== normalizePastedText ===');

// 1. Returns null when no changes needed
eq(
  normalizePastedText('hello world'),
  null,
  'returns null for clean text',
);

// 2. Collapses triple newlines
eq(
  normalizePastedText('a\n\n\nb'),
  'a\n\nb',
  'collapses triple newlines',
);

// 3. CRLF normalization
eq(
  normalizePastedText('a\r\nb\r\nc'),
  'a\nb\nc',
  'normalizes CRLF',
);

// 4. Dedent common whitespace
eq(
  normalizePastedText('  line1\n  line2\n  line3'),
  'line1\nline2\nline3',
  'dedents 2-space common indent',
);

// 5. Mixed indent — strips minimum
eq(
  normalizePastedText('    def a():\n        pass'),
  'def a():\n    pass',
  'strips minimum common indent (4 spaces)',
);

// 6. Single line — no dedent
eq(
  normalizePastedText('  single line'),
  null,
  'no dedent for single line',
);

/* ============================================================
 * validatePost
 * ============================================================ */

console.log('\n=== validatePost ===');

// 1. Empty input → error
{
  const errs = validatePost({ title: '', text: '', fileNames: [] });
  assert(errs.length > 0, 'empty input has errors');
  assert(errs[0].field === 'general', 'empty input error is general');
}

// 2. Title only → valid
eq(
  validatePost({ title: 'hello', text: '', fileNames: [] }).length,
  0,
  'title-only is valid',
);

// 3. Text only → valid
eq(
  validatePost({ title: '', text: 'content', fileNames: [] }).length,
  0,
  'text-only is valid',
);

// 4. Files only → valid
eq(
  validatePost({ title: '', text: '', fileNames: ['photo.jpg'] }).length,
  0,
  'files-only is valid',
);

// 5. Whitespace-only → error
{
  const errs = validatePost({ title: '   ', text: '  \n  ', fileNames: [] });
  assert(errs.length > 0, 'whitespace-only has errors');
}

// 6. Title too long → error
{
  const errs = validatePost({ title: 'x'.repeat(501), text: '', fileNames: [] });
  assert(errs.some(e => e.field === 'title'), 'long title has title error');
}

// 7. Text too long → error
{
  const errs = validatePost({ title: 'ok', text: 'x'.repeat(50001), fileNames: [] });
  assert(errs.some(e => e.field === 'text'), 'long text has text error');
}

/* ============================================================
 * buildPostInput
 * ============================================================ */

console.log('\n=== buildPostInput ===');

// 1. Basic new post
{
  const input: ComposerInput = {
    title: '  Привет мир  ',
    text: '```python\n  x = 1\n```',
    fileNames: ['photo.jpg'],
    customDate: '2026-03-24T10:30',
  };
  const out = buildPostInput(input);
  eq(out.title, 'Привет мир', 'trims title');
  eq(out.text, '```python\nx = 1\n```', 'normalizes text (dedents code)');
  assert(out.basename.startsWith('20260324_103000'), 'basename from customDate: ' + out.basename);
  assert(out.basename.includes('_privet_mir'), 'basename has transliterated title: ' + out.basename);
  eq(out.fileNames, ['photo.jpg'], 'passes file names through');
}

// 2. Edit mode — preserves timestamp prefix
{
  const input: ComposerInput = {
    title: 'Новое название',
    text: 'text',
    fileNames: [],
    editBasename: '20260320_083000_old_name',
  };
  const out = buildPostInput(input);
  assert(out.basename.startsWith('20260320_083000'), 'edit preserves timestamp: ' + out.basename);
  assert(out.basename.includes('_novoe_nazvanie'), 'edit updates title slug: ' + out.basename);
}

// 3. No title → basename without slug
{
  const input: ComposerInput = {
    title: '',
    text: 'just text',
    fileNames: [],
    customDate: '2026-01-15T08:00',
  };
  const out = buildPostInput(input);
  eq(out.basename, '20260115_080000', 'no title → no slug');
}

// 4. Text normalization in output
{
  const input: ComposerInput = {
    title: 'test',
    text: '```js\n\n  const x = 1;\n\n  ```',
    fileNames: [],
    customDate: '2026-01-01T00:00',
  };
  const out = buildPostInput(input);
  eq(out.text, '```js\nconst x = 1;\n```', 'buildPostInput normalizes code blocks in text');
}

/* ============================================================
 * insertTextAt
 * ============================================================ */

console.log('\n=== insertTextAt ===');

// 1. Insert at beginning
eq(
  insertTextAt('hello', 'XX', 0, 0),
  { value: 'XXhello', cursorPos: 2 },
  'insert at beginning',
);

// 2. Insert at end
eq(
  insertTextAt('hello', 'XX', 5, 5),
  { value: 'helloXX', cursorPos: 7 },
  'insert at end',
);

// 3. Replace selection
eq(
  insertTextAt('hello world', 'REPLACED', 6, 11),
  { value: 'hello REPLACED', cursorPos: 14 },
  'replace selection',
);

// 4. Insert in middle
eq(
  insertTextAt('abcd', 'XY', 2, 2),
  { value: 'abXYcd', cursorPos: 4 },
  'insert in middle',
);

/* ============================================================
 * End-to-end pipeline test
 * ============================================================ */

console.log('\n=== E2E pipeline ===');

{
  // Simulate: user pastes broken code → normalize → validate → build → output
  const rawPaste = '```python\r\n\r\n  def greet(name):\r\n\r\n      return f"ok"\r\n\r\n\r\n\r\n  print(greet("мир"))\r\n\r\n  ```';
  const normalized = normalizePastedText(rawPaste);
  assert(normalized !== null, 'e2e: paste was normalized');

  const input: ComposerInput = {
    title: 'Мой код',
    text: normalized!,
    fileNames: ['screenshot.png'],
    customDate: '2026-03-24T12:00',
  };

  const validationErrors = validatePost(input);
  eq(validationErrors.length, 0, 'e2e: validation passes');

  const output = buildPostInput(input);
  eq(output.title, 'Мой код', 'e2e: title clean');
  assert(!output.text.includes('\r'), 'e2e: no CR in text');
  assert(!output.text.includes('\n\n\n'), 'e2e: no triple newlines');
  assert(!output.text.includes('  ```'), 'e2e: no indented closing fence');
  assert(output.text.startsWith('```python\ndef'), 'e2e: code starts clean: ' + JSON.stringify(output.text.substring(0, 30)));
  assert(output.text.endsWith('\n```'), 'e2e: code ends clean');
  assert(output.basename.includes('_moy_kod'), 'e2e: basename has slug');
  eq(output.fileNames, ['screenshot.png'], 'e2e: files preserved');

  console.log('\n  E2E output.text:');
  console.log('  ' + JSON.stringify(output.text));
}

/* ============================================================
 * Results
 * ============================================================ */

console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (errors.length > 0) {
  console.log('\nFailures:');
  errors.forEach(e => console.log(`  ${e}`));
}
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
