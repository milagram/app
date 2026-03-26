# Milagram — Interaction Design Specification

**Version:** 3.2
**Date:** 2026-03-25

This specification describes interface micro-interactions:
animations, gestures, and visual feedback. It supplements
DESIGN.md (architecture, data structures, API).

---

## 1. Drag & Drop — Reordering Cards in the Feed

### 1.1 Initiation

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Trigger | `pointerdown` on drag-handle (`⋮⋮`) | Pointer Events API — unified code for mouse and touch |
| Activation threshold | 8px total displacement | Distinguishes a click from a drag |
| Cursor | `grabbing` on `<body>` | Global — not lost during fast movement |
| User-select | `none` on `<body>` | Prevents text selection during drag |

**Why Pointer Events instead of HTML5 Drag and Drop:**
- HTML5 DnD shows a forbidden cursor (`not-allowed`)
  between drop zones — impossible to remove
- No control over drag-preview appearance
- No touch support without a polyfill
- Pointer Events provide full control over visual behavior

### 1.2 Ghost (drag ghost)

A scaled-down copy of the card that follows the cursor —
shows **what** is being moved.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Content | `.event-body` (innerHTML clone) | Content only, without time-pill or metadata |
| Scale | `scale(0.35)` | ~3x reduction — does not obscure the drop zone |
| Rotation | `rotate(-2deg)` | Slight tilt — visual metaphor of being "in flight" |
| Transform-origin | `top right` | Card "hangs" from the grab point downward-left |
| Cursor anchor | Top-right corner of thumbnail = cursor position | Feeling of "dragging by the corner" |
| Opacity | `opacity: 0.8` | Semi-transparent — content beneath remains visible |
| Shadow | `0 6px 24px rgba(0,0,0,0.2)` | Elevation, detachment from the surface |
| Border-radius | `12px` | Matches card rounding |
| Pointer-events | `none` | Ghost must not intercept clicks |
| Z-index | `9999` | Above all content |
| Appear animation | `transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1.1)` | Springy scale-down on start |

### 1.3 Source card (during drag)

The card **stays in place** but is visually dimmed.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Opacity | `opacity: 0.45` on `.event-body` | Dimmed — shows where it was taken from without distraction |
| Scale | `scale(0.98)` on `.event-body` | Slight shrink — visual "press-in" effect |
| Transition | `opacity 0.2s, transform 0.2s` | Smooth dimming |

**Principle:** The card does not disappear (height: 0) or
collapse. The user must see where the card was taken from,
and the feed must not "jump."

### 1.4 Insert indicator (insert line)

Shows **where** the card will be inserted.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Appearance | Horizontal line, 3px | Thin but noticeable |
| Color | `var(--accent)` | Accent color — stands out from the monochrome feed |
| Glow | `box-shadow: 0 0 8px var(--accent)` | Additional attention cue |
| Position | `::before` or `::after` pseudo-element on the card | No extra DOM elements |
| Width | `calc(100% - 24px)` with `margin: 0 12px` | Slightly narrower than the card — clean look |
| Border-radius | `2px` | Rounded line ends |

### 1.5 Symmetric gap

Both cards at the insertion point spread apart, creating
a gap.

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Upper card | `margin-bottom: 20px` (class `.drop-gap-end`) | Pushes downward |
| Lower card | `margin-top: 20px` (class `.drop-above`) | Pushes upward |
| Transition | `margin 0.2s var(--apple-ease)` | Smooth spread |
| After last | `margin-bottom: 20px` (class `.drop-below`) | Gap at the bottom of the feed |

**Principle:** **Both** adjacent cards spread apart,
creating a symmetric gap. The insert line appears in the
center of the gap.

### 1.6 Determining the insertion position

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Method | Scan all `[data-gidx]` elements by `clientY` | Simple, reliable |
| Threshold | Midpoint of card height (`rect.top + rect.height / 2`) | Natural boundary |
| Exclusions | Position = current or current + 1 → null | Do not show insertion "in the same place" |
| Insert at end | `clientY` below last card → `posts.length` | Supports dragging to end of list |

### 1.7 Drop — landing animation

After release — the card appears at the new position with
a physically plausible animation.

#### Spring settle

```
@keyframes dropSettle
  0%    → scale(1.025), shadow 8px 30px — enlarged, elevated
  60%   → scale(0.995), shadow 2px 8px  — slightly compressed (overshoot)
  100%  → scale(1), no shadow           — normal size
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Duration | `0.5s` | Enough to register, does not slow down |
| Easing | `cubic-bezier(0.2, 0.8, 0.2, 1.1)` | Overshoot — springy effect |
| Applied to | `.event-body` | Content only, not time or gap |

#### Outline glow

```
@keyframes dropGlow
  0%    → outline 2px solid accent, offset 0   — outline appears
  40%   → outline 2px solid accent, offset 2px — expands outward
  100%  → outline 2px transparent, offset 4px  — dissolves
```

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Duration | `1.2s` | Longer than settle — gives the eye time to catch it |
| Easing | `ease-out` | Smooth fade-out |
| Color | `var(--accent)` | Accent — same system as the insert indicator |

**Principle:** Two animation layers:
1. **Spring** — physical response, "landed in place"
2. **Glow** — visual marker, "here it is"

### 1.8 Scroll-to-view

After drop — the card scrolls into the visible area.

| Parameter | Value |
|-----------|-------|
| Method | `scrollIntoView({ behavior: 'smooth', block: 'nearest' })` |
| Delay | `30ms` after reorder | Let React update the DOM |

### 1.9 Cleanup

On `pointerup` (even without a drop):
- Remove ghost from the DOM
- Reset `dragFromIdx`, `insertAtIdx` → remove all CSS classes
- Restore `cursor`, `userSelect` on `<body>`

---

## 2. Drag & Drop — File Previews in Composer

### 2.1 General parameters

| Parameter | Value |
|-----------|-------|
| API | Pointer Events (not HTML5 DnD) |
| Activation threshold | 8px |
| Orientation | Horizontal (X axis) |
| Cursor | `grab` → `grabbing` during drag |

### 2.2 Visual behavior

| State | Style |
|-------|-------|
| Idle | `cursor: grab` on `.preview-area` |
| Drag-source | `opacity: 0.3` on the element being moved |
| Insert indicator | Vertical line 2px `var(--accent)` between elements |

### 2.3 Native drag prevention

On `<img>` and `<video>` inside previews:
```css
pointer-events: none;
-webkit-user-drag: none;
```
Without this, the browser intercepts the drag and shows
the system preview.

---

## 2.4 Clipboard paste — image pasting

Images can be pasted from the clipboard (Ctrl+V / Cmd+V)
directly into the composer form.

| Parameter | Value |
|-----------|-------|
| Trigger | React `onPaste` on the `<form>` element |
| Data | `clipboardData.files` (image/*) |
| Sources | Screenshots, copies from browsers, messengers |
| Behavior | Files are added to previews as with drag & drop |
| Pattern | Standard (Slack, Discord, Notion) |

---

## 3. General Animation Principles

### 3.1 Easing functions

| Name | Value | Usage |
|------|-------|-------|
| Apple ease | `cubic-bezier(0.25, 0.1, 0.25, 1)` | Card spread, margin transitions |
| Spring | `cubic-bezier(0.2, 0.8, 0.2, 1.1)` | Drop settle, ghost appearance — overshoot |
| Standard | `ease-out` | Fade-out animations (glow, opacity) |

### 3.2 Durations

| Category | Duration | Examples |
|----------|----------|----------|
| Instant | `0.15s` | Opacity on drag start/end |
| Fast | `0.2s` | Margin spread, card scale, ghost transform |
| Medium | `0.5s` | Spring settle after drop |
| Long | `0.9–1.2s` | Outline glow, highlight flash |

### 3.3 Rules

1. **Physical plausibility** — animations mimic real
  physical properties (spring, inertia, friction)
2. **Functionality** — every animation conveys information
  (where it was inserted, what is being moved), not just
  decoration
3. **Non-blocking** — the user can act before the
  animation completes
4. **No excess** — at most 2 animation layers
  simultaneously (settle + glow)

---

## 4. Anti-patterns (what NOT to do)

| Don't | Why | Do instead |
|-------|-----|------------|
| Hide the card on drag (height: 0) | Feed jumps, "where it was taken from" context is lost | Dim with opacity + scale |
| Full-size ghost | Obscures the drop zone | Scale down ~3x, tilt |
| Ghost far from cursor | No sense of direct manipulation | Anchor corner to cursor |
| HTML5 Drag and Drop | Forbidden cursor between zones, no control | Pointer Events |
| Animation without information | Distracts, slows down | Every animation = feedback |
| One-sided spread | Unnatural — only one card moves | Symmetric spread of both |

---

## 5. Touch Drag — Mobile Devices (v6.0)

### 5.1 Long-press activation

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Delay | 500ms | Distinguishes scroll from intent to drag |
| Cancel threshold | 10px of movement | Finger moved → this is a scroll, drag is cancelled |
| Haptic feedback | `navigator.vibrate(30)` | Tactile confirmation: "card grabbed" |
| Visual feedback | Wiggle animation `rotate(±1.5°)` 300ms | Card "detached," ready for dragging |

### 5.2 Scroll blocking

| Parameter | Value |
|-----------|-------|
| `touch-action: none` on drag-handle | Prevents browser interception |
| `setPointerCapture(pointerId)` | Pointer events reach the handle even outside its bounds |
| `document.body.touchAction = 'none'` | Blocks page scroll during drag |

### 5.3 Auto-scroll during drag

| Parameter | Value |
|-----------|-------|
| Zone | 120px from scroll container edges |
| Max speed | 600px/sec |
| Curve | Cubic (`t³`) — soft start, fast near the edge |
| Update | requestAnimationFrame, time-based (px/sec × dt) |
| `scroll-behavior` | `auto` during drag (disables CSS smooth) |
| Restore | `scroll-behavior: ''` after drop |

## 6. Creating a New Day via Drag (v6.0)

| Parameter | Value |
|-----------|-------|
| Threshold | 20px beyond the feed edge (above the first or below the last element) |
| Visual | Badge `── + new day ──` with accent color |
| Date | Previous/next day from the edge, 12:00 |
| Animation | `scaleX(0.3→1)` with ease, 0.3s |

## 7. Pagination and Scroll (v6.0)

| Parameter | Value |
|-----------|-------|
| PAGE_SIZE | 8 posts (+ padding to complete the full day) |
| Direction | Inverted — latest entries at the bottom, older ones at the top |
| Trigger | scrollTop < 100px |
| Cooldown | 1.5s after channel load, 0.5s after each fetch |
| Position preservation | `scrollTop += scrollHeight - prevHeight` after prepend |
| Initial scroll | Instant (`scrollBehavior: auto`) to the bottom |

## 8. Adaptive Card Sizes (v6.0)

Desktop — width depends on content:

| Type | CSS | Width |
|------|-----|-------|
| Compact (short text) | `.event.compact > .event-body` | `fit-content`, max 85% |
| Single photo without text | `.event.media-only.single-media` | `fit-content`, max 85% |
| Single photo + text | `.event.single-media:not(.media-only)` | `fit-content`, max 85% |
| Everything else | default | 100% |

Mobile — all cards 100%.

## 9. Interactive Checkboxes (v6.0)

| Parameter | Value |
|-----------|-------|
| Markdown | `- [ ]` → unchecked, `- [x]` → checked |
| Render | `<input type="checkbox" data-check-idx="N">` (disabled removed) |
| Handling | `change` event with capture on scroll container |
| Style | Custom appearance, 18×18px, accent color, white checkmark |
| Completed | `text-decoration: line-through`, `color: var(--text-muted)` |
| Saving | Optimistic update + `api.updatePost()` |

---

## 10. Post Menu — Dropdown (v7.0)

**Desktop:** Compact floating popup next to the ⋮ button
via React Portal into `document.body`. `position: fixed`
with coordinates from `getBoundingClientRect()`. Animation
`menuPop` 0.12s. Invisible backdrop for closing.

**Mobile:** Bottom-sheet with dimming overlay
`backdrop-filter: blur(4px)`. Slide-up animation.
Backdrop with `event shield` — on close, an invisible div
absorbs remaining touch events for 400ms, preventing
click-through to the content beneath.

**Why Portal:** `.post-controls` created a stacking
context → menu z-index could not be higher than
header/input-wrapper. Portal into `document.body` solves
the problem.

## 11. DatePicker (v7.0)

### Desktop — flatpickr

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Library | flatpickr | Beautiful out of the box, 40KB, Russian localization |
| Closing | Only via OK or click outside | `fp.close` blocked by monkey-patch |
| Time | −/+ buttons (order: -1/1), mouse wheel | Native arrows hidden — they look bad |
| Days | Mouse wheel → switches month | |
| Month/year | Dropdown + input, mouse wheel | |
| Theme | All colors via CSS variables | Automatic dark mode |
| Size | 245px, font 12px | Compact |

### Mobile — native

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Input | `<input type="datetime-local">` | System picker on iOS/Android |
| Blur | 3-second timeout | Android blur on picker open ≠ cancel |
| Focus delay | 100ms | Android needs time to insert input into DOM |

**Why two approaches:** `showPicker()` is unreliable.
flatpickr on mobile conflicts with touch. The native
picker on desktop is ugly and does not close on onChange.

## 12. Quick Input Templates (v7.0)

| Parameter | Value |
|-----------|-------|
| Storage | `_templates.json` in the channel folder (server) |
| Sync | Automatic — same templates across all devices |
| Per-channel | Yes — each channel has its own templates |
| Limits | 50 templates, 200 characters each |
| UI | Popup via Portal, list + delete + save |
| Insertion | Click on template → title is populated |
| Saving | If title is filled → "Save +" button |

## 13. Lightbox — Closing (v7.0)

| Method | Implementation |
|--------|----------------|
| Close button × | Button in header |
| Download ⬇ | Button in header — downloads the original |
| Escape | Keyboard handler |
| Background click | `e.target === bodyRef.current` → not img/video/nav |
| Swipe down | Mobile (touch) |
| Back (Android) | `history.pushState` + `popstate` — standard mobile SPA pattern (Instagram, Google Photos) |

## 14. Sticky Day Headers (v7.0)

| Parameter | Value |
|-----------|-------|
| CSS | `position: sticky; top: 0` |
| Background | `backdrop-filter: blur(8px)`, semi-transparent |
| z-index | 8 — above cards, below modals |
| Style | Pill text, muted color, uppercase 11px |
| Link-copied | Accent color when copying a date link |

## 15. Header Actions (v7.0)

| Element | Icon | Action |
|---------|------|--------|
| Tag filter | SVG (3 lines of decreasing width) | Dropdown with tags via Portal |
| Search | SVG (magnifying glass) | Expands input field below header |
| Active filter | Pill-badge with × | Click = reset filter |

All icons — SVG 20×20, stroke-based, uniform style.
Buttons 38×38px.

## 16. Entry Types — Visual Styles (v7.0)

### Compact (no card)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Background | `none` | Minimal visual weight |
| Shadow | `none` | |
| Border | `none`, only `border-bottom: 1px` between entries | Divider instead of a card |
| Margin | `0` | Entries are packed tightly |
| Title | 14px/500, no accent border | Not prominent — it is a line, not a heading |
| Time | `top: 10px` | Aligned with text level |

### Full card

| Parameter | Value |
|-----------|-------|
| Background | `var(--card-bg)` |
| Border | `0.5px solid var(--border)` |
| Shadow | `0 1px 2px rgba(0,0,0,0.04)` — minimal |
| Rounding | `14px` |
| Title | Tinted header + accent left-border |
| Time | `top: 13px` — centered on the first line |

### Single media

`fit-content` only for **media-only** (no text).
If text is present — full width.

| Variant | Width | Photo |
|---------|-------|-------|
| Media-only + 1 photo | `fit-content`, max 85% | `contain`, natural proportions |
| Captioned + 1 photo | 100% | `cover`, full width |
| Full card + 1 photo | 100% | `cover`, full width |

**Why:** if the card shrinks to fit the photo but has
text — the text gets clipped or overflows the boundary.

### Captioned media — glass header + content below (v7.1)

Uses the same silver frosted glass header as full cards.
Unified header style.

| Parameter | Value |
|-----------|-------|
| Layout | Glass header on top, media below (overlaps header by 10px) |
| Header | Same `.post-header:has(.post-title)` — silver glass, `border-radius: 12px` |
| Content | `margin-top: -10px`, `border-radius: 0 0 14px 14px`, edge-to-edge |
| event-body | `padding: 0`, `background: none`, `border: none` |
| Controls | White icons on glass header |

### Media-only

| Parameter | Value |
|-----------|-------|
| Padding | `0` — photo flush to card edges |
| Menu | Overlay on top of photo |
| Rounding | `12px` on media-grid |

### Links in entries

| Parameter | Value |
|-----------|-------|
| Color | `var(--accent)` |
| Background | `color-mix(accent 8%)` — highlight |
| Hover | Background 16%, active 24% |
| Word-break | `break-all` — long URLs wrap |
| Where | `.post-text a`, `.post-title a`, `.event-text a` |
