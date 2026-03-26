/**
 * composer-logic.ts — Pure functions for post input logic
 *
 * No dependencies on React, DOM, API, or Store
 * Testable with a simple Node.js script
 *
 * Pipeline:  raw input → normalizeText → validatePost → buildPostInput → PostInput
 */

import { transliterate, formatDateToCustom } from './utils';
import i18n from './i18n';

/* ============================================================
 * Types (re-exported for convenience)
 * ============================================================ */

export interface ComposerInput {
  title: string;
  text: string;
  fileNames: string[];       // just names, no File objects — pure data
  customDate?: string;       // datetime-local string or empty
  /** If editing, the original post's basename */
  editBasename?: string;
}

export interface ComposerOutput {
  title: string;
  text: string;
  basename: string;
  customDate?: string;
  fileNames: string[];
}

export interface ValidationError {
  field: 'title' | 'text' | 'files' | 'general';
  message: string;
}

/* ============================================================
 * normalizeText — fix paste artifacts in text
 * ============================================================ */

/**
 * Normalize text input: fix line endings, collapse excessive blank lines,
 * dedent common whitespace inside code fences, fix indented closing fences
 *
 * Pure function: string → string
 */
export function normalizeText(text: string): string {
  // Normalize line endings
  let t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // Inside code fences: collapse 3+ blank lines → 1, dedent common leading spaces
  // Allow indented closing fence (common when pasting from web)
  t = t.replace(/(```\w*)\n([\s\S]*?)\n[ \t]*(```)/g, (_match, open: string, body: string) => {
    // Collapse 3+ blank lines → 1 inside code blocks (paste artifacts)
    let code = body.replace(/\n{3,}/g, '\n\n');
    // Remove leading/trailing blank lines inside code block
    code = code.replace(/^\n+/, '').replace(/\n+$/, '');
    // Dedent: find minimum indentation and strip it
    const lines = code.split('\n');
    const nonEmpty = lines.filter((l: string) => l.trim().length > 0);
    if (nonEmpty.length > 0) {
      const minIndent = Math.min(...nonEmpty.map((l: string) => (l.match(/^( +)/)?.[1]?.length ?? 0)));
      if (minIndent > 0) {
        code = lines.map((l: string) => l.substring(Math.min(minIndent, l.length))).join('\n');
      }
    }
    return `${open}\n${code}\n\`\`\``;
  });
  return t;
}

/**
 * Normalize pasted clipboard text: collapse blank lines, dedent
 * Used by paste handler before inserting into textarea
 *
 * Returns null if no normalization needed (let browser handle natively)
 */
export function normalizePastedText(pasted: string): string | null {
  let normalized = pasted
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  // Dedent: if every non-empty line has the same leading whitespace, strip it
  const lines = normalized.split('\n');
  const nonEmptyLines = lines.filter(l => l.trim().length > 0);
  if (nonEmptyLines.length > 1) {
    const leadingSpaces = nonEmptyLines.map(l => l.match(/^( +)/)?.[1]?.length ?? 0);
    const minIndent = Math.min(...leadingSpaces);
    if (minIndent > 0) {
      normalized = lines.map(l => l.substring(Math.min(minIndent, l.length))).join('\n');
    }
  }

  return normalized === pasted ? null : normalized;
}

/* ============================================================
 * validatePost — check if input is valid
 * ============================================================ */

/**
 * Validate composer input. Returns array of errors (empty = valid)
 *
 * Pure function: ComposerInput → ValidationError[]
 */
export function validatePost(input: ComposerInput): ValidationError[] {
  const errors: ValidationError[] = [];

  const hasTitle = input.title.trim().length > 0;
  const hasText = input.text.trim().length > 0;
  const hasFiles = input.fileNames.length > 0;

  if (!hasTitle && !hasText && !hasFiles) {
    errors.push({ field: 'general', message: i18n.t('validation.empty') });
  }

  if (input.title.length > 500) {
    errors.push({ field: 'title', message: i18n.t('validation.titleTooLong') });
  }

  if (input.text.length > 50000) {
    errors.push({ field: 'text', message: i18n.t('validation.textTooLong') });
  }

  return errors;
}

/* ============================================================
 * buildPostInput — transform raw form data into output
 * ============================================================ */

/**
 * Build the final post data from form input
 * Applies normalizeText, trims, generates basename
 *
 * Pure function: ComposerInput → ComposerOutput
 */
export function buildPostInput(input: ComposerInput): ComposerOutput {
  const title = input.title.trim();
  const text = normalizeText(input.text.trim());
  const titleSlug = title ? '_' + transliterate(title) : '';

  let basename: string;
  if (input.editBasename) {
    // Editing: keep timestamp prefix (first 15 chars), update title slug
    basename = input.editBasename.substring(0, 15) + titleSlug;
  } else {
    // New post: generate timestamp
    const postDate = input.customDate ? new Date(input.customDate) : new Date();
    basename = formatDateToCustom(postDate) + titleSlug;
  }

  return {
    title,
    text,
    basename,
    customDate: input.customDate || undefined,
    fileNames: input.fileNames,
  };
}

/* ============================================================
 * insertTextAtCursor — pure string manipulation for paste
 * ============================================================ */

/**
 * Insert text into a string at cursor position
 * Returns { value, cursorPos } — new string and where cursor should be
 */
export function insertTextAt(
  current: string,
  insert: string,
  selectionStart: number,
  selectionEnd: number,
): { value: string; cursorPos: number } {
  const before = current.substring(0, selectionStart);
  const after = current.substring(selectionEnd);
  return {
    value: before + insert + after,
    cursorPos: selectionStart + insert.length,
  };
}
