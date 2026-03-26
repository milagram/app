/**
 * Utilities — transliterate, dates, markdown, clipboard, helpers
 * All in one file for simplicity
 */

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/core';
import { normalizeText } from './composer-logic';
import i18n from './i18n';

// Register common languages (lazy — only loaded when imported)
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('css', css);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('json', json);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('yaml', yaml);
hljs.registerLanguage('yml', yaml);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('md', markdown);

// Configure marked with highlight.js via extension
marked.setOptions({ breaks: true });
marked.use({
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      let highlighted = text;
      if (lang && hljs.getLanguage(lang)) {
        try { highlighted = hljs.highlight(text, { language: lang }).value; } catch {}
      } else {
        try { highlighted = hljs.highlightAuto(text).value; } catch {}
      }
      const cls = lang ? `hljs language-${lang}` : 'hljs';
      const escaped = text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const header = lang
        ? `<div class="code-header"><span class="code-lang">${lang}</span><button class="code-copy" data-code="${escaped}">${i18n.t('utils.copy')}</button></div>`
        : `<button class="code-copy floating" data-code="${escaped}">${i18n.t('utils.copy')}</button>`;
      return `<div class="code-block">${header}<pre><code class="${cls}">${highlighted}</code></pre></div>`;
    },
  },
});

/* ============================================================
 * Transliteration
 * ============================================================ */

const CYRILLIC_MAP: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu',
  'я': 'ya', ' ': '_',
};

/** Transliterate Cyrillic → Latin for folder names, truncated to 40 chars. */
export function transliterate(text: string): string {
  const result = text
    .toLowerCase()
    .split('')
    .map(c => CYRILLIC_MAP[c] || c)
    .join('')
    .replace(/[^a-z0-9_]/g, '');
  return result.substring(0, 40).replace(/_+$/, '');
}

/* ============================================================
 * Date utilities
 * ============================================================ */

/** Parse folder-name date "YYYYMMDD_HHMMSS" → Date. */
export function parseCustomDate(s: string): Date {
  return new Date(
    parseInt(s.substring(0, 4)),
    parseInt(s.substring(4, 6)) - 1,
    parseInt(s.substring(6, 8)),
    parseInt(s.substring(9, 11)),
    parseInt(s.substring(11, 13)),
    parseInt(s.substring(13, 15)),
  );
}

/** Date → "YYYYMMDD_HHMMSS" folder-name string. */
export function formatDateToCustom(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

/** Date → "YYYY-MM-DDTHH:MM" for datetime-local input. */
export function formatDateForInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Basename → timestamp in milliseconds. */
export function getTimeMs(basename: string): number {
  return parseCustomDate(basename.substring(0, 15)).getTime();
}

/** Format date for display (e.g., "20 March 2026" in Russian). */
export function formatDisplayDate(dateStr: string): string {
  const months = Array.from({length: 12}, (_, i) => i18n.t('months.' + i));
  const d = parseCustomDate(dateStr);
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** Format time from basename (e.g., "08:30"). */
export function formatTime(basename: string): string {
  return `${basename.substring(9, 11)}:${basename.substring(11, 13)}`;
}

/* ============================================================
 * Markdown rendering
 * ============================================================ */

/** Render markdown text with hashtag links and DOMPurify sanitization. */
export function renderMarkdown(text: string): string {
  if (!text) return '';
  const normalized = normalizeText(text);
  // Replace #hashtags with clickable spans (handled by React onClick in Feed)
  const processed = normalized.replace(
    /(^|\s)(#[\wа-яё]+)/gi,
    '$1<span class="hashtag" data-tag="$2">$2</span>',
  );
  let html = marked.parse(processed) as string;
  // Clean up trailing <br> before </p> (caused by breaks:true + blank lines)
  html = html.replace(/<br>\s*<\/p>/g, '</p>');
  // Make checkboxes interactive: remove disabled, add data-check-idx
  let checkIdx = 0;
  html = html.replace(/<input\s+(checked=""\s+)?disabled=""\s+type="checkbox">/g, (_match, checked) => {
    const idx = checkIdx++;
    return `<input type="checkbox" data-check-idx="${idx}"${checked ? ' checked' : ''}>`;
  });
  return DOMPurify.sanitize(html, {
    ADD_TAGS: ['button', 'input'],
    ADD_ATTR: ['data-code', 'data-tag', 'data-check-idx', 'type', 'checked'],
  });
}

/** Generate Obsidian-compatible .md file content for a post. */
export function generateMarkdownContent(post: { created_at: string; title: string; text: string; files: { name: string }[] }): string {
  let md = '---\n';
  md += `created_at: ${post.created_at}\n`;
  const tags = (post.text.match(/#[\wа-яё]+/gi) || []).map(t => t.substring(1));
  if (tags.length > 0) md += `tags: [${tags.join(', ')}]\n`;
  md += '---\n\n';
  if (post.title) md += `# ${post.title}\n\n`;
  if (post.text) md += `${post.text}\n\n`;
  post.files.forEach(f => { md += `![[${f.name}]]\n`; });
  return md;
}

/* ============================================================
 * Clipboard
 * ============================================================ */

/** Copy text to clipboard — works on HTTP too. */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch { /* fallback */ }
  }
  // Fallback for HTTP
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;left:-9999px;top:-9999px';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch { /* ignore */ }
  document.body.removeChild(ta);
}

/* ============================================================
 * Helpers
 * ============================================================ */

/** Check if a filename is a video. */
const VIDEO_EXT = /\.(mp4|mov|webm|avi|mkv|m4v|3gp)$/i;
export function isVideo(name: string): boolean {
  return VIDEO_EXT.test(name);
}

/** Return CSS class for smart media grid layout. */
export function getMediaGridClass(count: number): string {
  if (count === 2) return 'media-count-2';
  if (count === 3) return 'media-count-3';
  if (count === 4) return 'media-count-4';
  if (count === 5) return 'media-count-5';
  if (count >= 6) return 'media-count-many';
  return '';
}

/** Escape HTML for safe display. */
export function escapeHtml(str: string): string {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

/** Format bytes to human-readable string. */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/** ZIP export — download channel as Obsidian-ready vault. */
export async function exportChannelZip(
  channel: string,
  posts: { basename: string; title: string; text: string; created_at: string; files: { name: string; url?: string; fileObj?: File }[] }[],
): Promise<void> {
  if (!posts.length) {
    alert(i18n.t('utils.noPostsExport'));
    return;
  }
  const JSZip = (await import('jszip')).default;
  try {
    const zip = new JSZip();
    const vault = zip.folder('Milagram-Vault')!;
    const channelFolder = vault.folder(channel)!;

    for (const post of posts) {
      const folder = channelFolder.folder(post.basename)!;
      folder.file(`${post.basename}.md`, generateMarkdownContent(post));
      for (const file of post.files) {
        if (file.fileObj) {
          folder.file(file.name, file.fileObj);
        } else {
          // Placeholder 1x1 pixel for remote files
          const placeholder =
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
          folder.file(file.name, placeholder, { base64: true });
        }
      }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = `Milagram-${channel}.zip`;
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (err) {
    console.error('ZIP export failed:', err);
    alert(i18n.t('utils.zipFailed'));
  }
}

/** Extract unique hashtags from posts (title + text). */
export function extractTags(posts: { title?: string; text: string }[]): string[] {
  const tags = new Set<string>();
  posts.forEach(p => {
    const combined = (p.title || '') + ' ' + p.text;
    const matches = combined.match(/#[\wа-яё]+/gi);
    if (matches) matches.forEach(t => tags.add(t.toLowerCase()));
  });
  return [...tags].sort();
}
