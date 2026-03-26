# Milagram — Frontend Testing

**Version:** 1.1
**Date:** 2026-03-25

## Running Tests

```bash
cd frontend
npx tsx src/composer-logic.test.ts
```

Tests do not require a browser, DOM, or React — only Node.js.

## What Is Tested

The file `src/composer-logic.test.ts` covers pure
functions from `src/composer-logic.ts` — input processing
logic separated from the UI.

### normalizeText (12 tests)

Text normalization before saving/rendering:

| Case | What it verifies |
|------|------------------|
| Normal code | Block without artifacts stays unchanged |
| Double newlines in code | `\n\n\n\n` inside ``` → `\n\n` |
| Empty lines at edges | Leading/trailing `\n` in block are removed |
| Common indent | 2 spaces on every line → removed |
| Indent on ``` | `  ` ``` → ``` (fix for web page pastes) |
| Real user input | Full case with double newlines + indents |
| CRLF | `\r\n` → `\n` |
| Plain text | No code fence — only newline normalization |
| Multiple blocks | Each block is normalized independently |
| Single empty line | Not collapsed — it is an intentional separator |
| Zero indent | Lines without common indent — nothing removed |
| Language with digits | ````python3` — parsed correctly |

### normalizePastedText (6 tests)

Processing clipboard text on paste:

| Case | What it verifies |
|------|------------------|
| Clean text | Returns `null` — browser handles it natively |
| Triple newlines | Collapsed to a single empty line |
| CRLF | Normalizes Windows line endings |
| Common indent | Removes identical leading spaces from each line |
| Mixed indent | Removes the minimum common indent |
| Single line | Not dedented — `null` |

### validatePost (7 tests)

Form data validation:

| Case | Result |
|------|--------|
| Everything empty | Error `general` |
| Title only | OK |
| Text only | OK |
| Files only | OK |
| Whitespace only | Error |
| Title > 500 characters | Error `title` |
| Text > 50000 characters | Error `text` |

### buildPostInput (4 tests)

Transforming form data into a ready-made object for the API:

| Case | What it verifies |
|------|------------------|
| New post | trim, text normalization, basename from date + transliterated title |
| Editing | Preserves timestamp (15 characters), updates slug |
| No title | basename without slug suffix |
| Normalization in text | Code fence in text is normalized during assembly |

### insertTextAt (4 tests)

Inserting text at cursor position:

| Case | What it verifies |
|------|------------------|
| At the start | Cursor position after insertion |
| At the end | Cursor position after insertion |
| Replace selection | Selected fragment is replaced |
| In the middle | String is split correctly |

### E2E pipeline (1 test)

Full path: broken paste from a web page →
`normalizePastedText` → `validatePost` →
`buildPostInput` → clean result. Verifies the
absence of `\r`, triple newlines, indented ```,
correct basename and slug.

## Architecture

```
composer-logic.ts       ← pure functions (0 dependencies on React/DOM)
  ├── normalizeText()
  ├── normalizePastedText()
  ├── validatePost()
  ├── buildPostInput()
  └── insertTextAt()

Composer.tsx
  ├── ComposerForm      ← UI, calls composer-logic, passes onSubmit(output)
  └── Composer           ← shell: API, upload, store
```

`ComposerForm` knows nothing about API, upload, or
store — it accepts `onSubmit(output, files)` and returns
a ready-made `ComposerOutput`. All data processing goes
through pure functions that can be tested without a
browser.

## Adding Tests

Tests use simple `assert` functions without frameworks.
To add a new test:

```ts
eq(
  normalizeText('input data'),
  'expected result',
  'test description',
);
```

Exits with code 1 on any failure — compatible with CI.
