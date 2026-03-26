#!/usr/bin/env python3
"""
Import Telegram channel/chat export (JSON format) into Milagram.

Usage:
  python tools/import_telegram.py --channel family --posts-dir ./posts ./telegram_export/result.json

Telegram Desktop export:
  Settings → Advanced → Export Telegram Data → JSON + Media

The script:
  1. Reads result.json
  2. For each message with text or media:
     - Creates YYYYMMDD_HHMMSS_slug/ folder
     - Generates .md file with YAML frontmatter
     - Copies photos/videos into the folder
  3. Skips already imported messages (by date+text hash)
"""

import argparse
import hashlib
import json
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional


def transliterate(text: str) -> str:
    """Transliterate Cyrillic to Latin for folder names"""
    cyr = {
        'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo',
        'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm',
        'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u',
        'ф': 'f', 'х': 'h', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'sch',
        'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya', ' ': '_',
    }
    result = ''.join(cyr.get(c, c) for c in text.lower())
    result = re.sub(r'[^a-z0-9_]', '', result)
    return result[:40].rstrip('_')


def extract_text(msg: dict) -> str:
    """Extract plain text from Telegram message (handles mixed text entities)"""
    text_field = msg.get('text', '')
    if isinstance(text_field, str):
        return text_field
    if isinstance(text_field, list):
        parts = []
        for part in text_field:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                parts.append(part.get('text', ''))
        return ''.join(parts)
    return ''


def get_media_path(msg: dict, export_dir: Path) -> Optional[Path]:
    """Get the media file path from a Telegram message"""
    for key in ('photo', 'file'):
        val = msg.get(key)
        if val and isinstance(val, str):
            p = export_dir / val
            if p.exists():
                return p
    # Thumbnail
    if 'thumbnail' in msg:
        val = msg['thumbnail']
        if isinstance(val, str):
            p = export_dir / val
            if p.exists():
                return p
    return None


def get_all_media(msg: dict, export_dir: Path) -> list[Path]:
    """Get all media files from a message (photo + file)"""
    files = []
    for key in ('photo', 'file'):
        val = msg.get(key)
        if val and isinstance(val, str):
            p = export_dir / val
            if p.exists():
                files.append(p)
    return files


def make_basename(dt: datetime, title: str) -> str:
    """Create folder basename from datetime and title"""
    base = dt.strftime('%Y%m%d_%H%M%S')
    if title:
        slug = transliterate(title)
        if slug:
            base += '_' + slug
    return base


def generate_md(title: str, text: str, files: list[str], created_at: str) -> str:
    """Generate Obsidian-compatible .md content"""
    # Normalize line endings
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    title = title.replace('\r\n', '\n').replace('\r', '\n')

    lines = ['---']
    lines.append(f'created_at: {created_at}')
    tags = re.findall(r'#([\w\u0430-\u044f\u0451]+)', text, re.IGNORECASE)
    if tags:
        lines.append(f'tags: [{", ".join(tags)}]')
    lines.append('---\n')
    if title:
        lines.append(f'# {title}\n')
    if text:
        lines.append(f'{text}\n')
    for f in files:
        lines.append(f'![[{f}]]')
    return '\n'.join(lines) + '\n'


def split_title_text(full_text: str) -> tuple[str, str]:
    """Split message into title (first line, if short) and body text"""
    if not full_text:
        return '', ''
    lines = full_text.strip().split('\n')
    first = lines[0].strip()
    # First line as title if short and no code
    if len(first) < 100 and not first.startswith('```') and len(lines) > 1:
        rest = '\n'.join(lines[1:]).strip()
        return first, rest
    if len(first) < 100 and len(lines) == 1:
        return first, ''
    return '', full_text


def import_telegram(json_path: Path, channel: str, posts_dir: Path, skip_existing: bool = True):
    """Import Telegram JSON export into Milagram channel"""
    export_dir = json_path.parent
    channel_dir = posts_dir / channel

    # Create channel dir and metadata if needed
    channel_dir.mkdir(parents=True, exist_ok=True)
    meta_file = channel_dir / '_channel.json'
    if not meta_file.exists():
        meta = {
            'name': channel,
            'displayName': channel.capitalize(),
            'emoji': '💬',
            'description': f'Imported from Telegram',
            'createdAt': datetime.now().isoformat(),
        }
        meta_file.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
        print(f'Created channel: {channel}')

    # Read JSON
    with open(json_path, encoding='utf-8') as f:
        data = json.load(f)

    messages = data.get('messages', [])
    if not messages:
        print('No messages found in export.')
        return

    # Track existing basenames to skip duplicates
    existing = set()
    if skip_existing:
        for d in channel_dir.iterdir():
            if d.is_dir() and not d.name.startswith('.') and not d.name.startswith('_'):
                existing.add(d.name[:15])  # YYYYMMDD_HHMMSS

    imported = 0
    skipped = 0

    for msg in messages:
        if msg.get('type') != 'message':
            continue

        date_str = msg.get('date', '')
        if not date_str:
            continue

        text = extract_text(msg)
        media_files = get_all_media(msg, export_dir)

        # Skip empty messages
        if not text and not media_files:
            skipped += 1
            continue

        # Parse date
        try:
            dt = datetime.fromisoformat(date_str)
        except ValueError:
            skipped += 1
            continue

        # Skip if already exists
        date_prefix = dt.strftime('%Y%m%d_%H%M%S')
        if skip_existing and date_prefix in existing:
            skipped += 1
            continue

        # Split into title + text
        title, body = split_title_text(text)

        # Create folder
        basename = make_basename(dt, title)

        # Handle collision
        folder = channel_dir / basename
        if folder.exists():
            basename += f'_{msg.get("id", 0)}'
            folder = channel_dir / basename

        folder.mkdir(parents=True)

        # Copy media
        file_names = []
        for media_path in media_files:
            dest = folder / media_path.name
            shutil.copy2(media_path, dest)
            file_names.append(media_path.name)

        # Generate .md
        created_at = dt.isoformat()
        md = generate_md(title, body, file_names, created_at)
        (folder / f'{basename}.md').write_text(md, encoding='utf-8')

        imported += 1
        if imported % 50 == 0:
            print(f'  ...imported {imported} messages')

    print(f'\nDone! Imported: {imported}, Skipped: {skipped}')
    print(f'Channel: {channel_dir}')


def main():
    parser = argparse.ArgumentParser(description='Import Telegram export into Milagram')
    parser.add_argument('json_file', type=Path, help='Path to result.json from Telegram export')
    parser.add_argument('--channel', required=True, help='Target channel name (e.g., "family")')
    parser.add_argument('--posts-dir', type=Path, default=Path('./posts'),
                        help='Posts directory (default: ./posts)')
    parser.add_argument('--no-skip', action='store_true',
                        help='Do not skip already imported messages')
    args = parser.parse_args()

    if not args.json_file.exists():
        print(f'Error: {args.json_file} not found')
        sys.exit(1)

    import_telegram(args.json_file, args.channel, args.posts_dir, skip_existing=not args.no_skip)


if __name__ == '__main__':
    main()
