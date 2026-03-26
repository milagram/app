# Demo Data — test entries

20 entries to demonstrate all content types and for testing.

## Installation

Copy the contents to a channel folder:

```bash
# Create a demo channel (or any other)
cp -r demo-data/ posts/demo/
```

Or via API:
```bash
# Archive and import
zip -r demo.zip demo-data/
# Upload via admin panel → Import
```

After copying, restart the backend or refresh the page — posts will appear in the channel.

## Contents

### Compact (5 posts) — no card, lines with separator

| Post | Content |
|------|---------|
| 20260320_073000 | Vitamin D #health |
| 20260320_074500 | 5 km run #sport |
| 20260320_080000 | Magnesium + zinc #supplements |
| 20260323_091000 | Link to an article |
| 20260324_070000 | Workout + shower #health #sport |

### Full Card (8 posts) — card with heading

| Post | Content type |
|------|-------------|
| 20260320_083000_borscht_recipe | Recipe (ingredient list, steps) |
| 20260320_090000_backup_script | Bash code (backup script) |
| 20260321_082900_weekend_plans | Checklist (- [ ] / - [x]) |
| 20260322_093000_breakfast_at_a_new_cafe | Text + 1 photo |
| 20260322_200000_thinking_fast_and_slow | Quote (blockquote) |
| 20260323_140000_kids_room_makeover | Text + 4 photos (2×2 grid) |
| 20260324_065930_csv_parser | Python code |
| 20260324_160000_5_productivity_rules | Numbered list + quote |

### Captioned Media (4 posts) — glass heading + photo

| Post | Media |
|------|-------|
| 20260321_083000_sunrise_over_the_city | 1 photo |
| 20260321_160000_walk_in_the_park | 2 photos |
| 20260324_065900_dinner_for_5 | 5 photos (banner + 4) |
| 20260324_160030_evening_walk_by_the_river | 1 photo, long heading |

### Media Only (3 posts) — photos without text

| Post | Media |
|------|-------|
| 20260321_150000 | 1 photo |
| 20260321_170000 | 3 photos (banner + 2) |
| 20260324_160100 | 6 photos (3×2 grid) |

## Hashtags

`#health` `#sport` `#supplements` `#food` `#code` `#plans` `#nature` `#family` `#books` `#home` `#notes`

## Templates

The `_templates.json` file contains 2 quick-entry templates for testing.

## Media

48 files — random photos from picsum.photos (placeholder images). Thumbnails `.thumbs/` are not included — they are generated automatically on first request.
