/**
 * Feed.tsx — Post feed
 *
 * Contains:
 * - ChannelView — main channel page (filters + feed)
 * - FilterBar — hashtag chips
 * - DayGroup — group of posts for a single day
 * - PostCard — single post card
 * - PostMedia — media grid inside a post
 * - PostMenu — dropdown/bottom-sheet post menu
 */

import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { flushSync, createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './store';
import { api } from './api';
import flatpickr from 'flatpickr';
import type { Post, MediaFile } from './api';
import {
  renderMarkdown, formatTime, formatDisplayDate, getMediaGridClass,
  isVideo, escapeHtml, generateMarkdownContent, extractTags, formatBytes,
  copyToClipboard, getTimeMs, formatDateToCustom, parseCustomDate, formatDateForInput,
} from './utils';

/* ============================================================
 * ChannelView
 * ============================================================ */

const PAGE_SIZE = 8;

export function ChannelView() {
  const { t } = useTranslation();
  const { posts, hasMorePosts, activeFilter, setFilter, searchQuery, setSearchQuery, currentChannel, showMeta, setPosts, prependPosts, setHasMorePosts } = useAppStore();
  const [searchOpen, setSearchOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchParams] = useSearchParams();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchResults, setSearchResults] = useState<Post[] | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Server-side search with debounce
  useEffect(() => {
    if (!searchQuery.trim() || !currentChannel) {
      setSearchResults(null);
      return;
    }
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await api.getPosts(currentChannel, { search: searchQuery.trim() });
        setSearchResults(results);
      } catch { setSearchResults(null); }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, currentChannel]);

  // Extract tags from all posts
  const tags = useMemo(() => extractTags(posts), [posts]);

  // Filter posts — search uses server results, tag filter is client-side
  const filtered = useMemo(() => {
    const source = searchResults || posts;
    return source
      .map((post, index) => ({ post, globalIndex: index }))
      .filter(item => {
        if (activeFilter !== 'all') {
          const combined = (item.post.title || '') + ' ' + (item.post.text || '');
          const postTags = (combined.match(/#[\wа-яё]+/gi) || []).map(t => t.toLowerCase());
          if (!postTags.includes(activeFilter)) return false;
        }
        return true;
      });
  }, [posts, searchResults, activeFilter]);

  // Group by day
  const days = useMemo(() => {
    const groups: Record<string, { post: Post; globalIndex: number }[]> = {};
    filtered.forEach(item => {
      const dayKey = item.post.basename.substring(0, 8);
      if (!groups[dayKey]) groups[dayKey] = [];
      groups[dayKey].push(item);
    });
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  /* ---- Post drag-reorder (pointer events) ---- */
  const dragRef = useRef<{ fromIdx: number; startX: number; startY: number; active: boolean; offsetY: number; armed: boolean } | null>(null);
  const insertRef = useRef<number | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoScrollRef = useRef<{ raf: number; clientY: number } | null>(null);
  const insertAboveDayRef = useRef(false);
  const newDayRef = useRef<'prev' | 'next' | null>(null);
  const [dragFromIdx, setDragFromIdx] = useState<number | null>(null);
  const [insertAtIdx, setInsertAtIdx] = useState<number | null>(null);
  const [insertAboveDay, setInsertAboveDay] = useState(false);
  const [newDayMode, setNewDayMode] = useState<'prev' | 'next' | null>(null);

  // Find which gap the cursor is in
  // Returns globalIndex to insert before, or posts.length for after-last
  // Also returns whether cursor is above a day-header (affects which card shows the line)
  // Pure position scan — returns insert position based on cursor Y
  // newDay: cursor is far above first or far below last element → create new day
  const NEW_DAY_THRESHOLD = 20; // px beyond the edge to trigger new day

  const calcInsertY = useCallback((clientY: number): { idx: number; aboveDayHeader: boolean; newDay: 'prev' | 'next' | null } | null => {
    if (!scrollRef.current) return null;
    const els = scrollRef.current.querySelectorAll<HTMLElement>('[data-gidx], [data-day-first]');
    if (els.length === 0) return null;

    // Cursor above everything
    const firstRect = els[0].getBoundingClientRect();
    if (clientY < firstRect.top) {
      const dist = firstRect.top - clientY;
      return { idx: 0, aboveDayHeader: true, newDay: dist > NEW_DAY_THRESHOLD ? 'prev' : null };
    }

    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const isDayHeader = el.dataset.dayFirst != null;
      const gidx = isDayHeader ? parseInt(el.dataset.dayFirst!) : parseInt(el.dataset.gidx!);
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return { idx: gidx, aboveDayHeader: isDayHeader, newDay: null };
      }
    }

    // Cursor below everything
    const lastEl = els[els.length - 1];
    const lastRect = lastEl.getBoundingClientRect();
    const lastGidx = lastEl.dataset.dayFirst != null
      ? parseInt(lastEl.dataset.dayFirst!)
      : parseInt(lastEl.dataset.gidx!) + 1;
    const dist = clientY - lastRect.bottom;
    return { idx: lastGidx, aboveDayHeader: false, newDay: dist > NEW_DAY_THRESHOLD ? 'next' : null };
  }, []);

  const handleDragHandleDown = useCallback((globalIndex: number, clientX: number, clientY: number, pointerType: string) => {
    const isTouch = pointerType === 'touch';
    dragRef.current = { fromIdx: globalIndex, startX: clientX, startY: clientY, active: false, offsetY: 0, armed: !isTouch };

    if (isTouch) {
      // Long-press: arm after delay, then animate + vibrate
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      holdTimerRef.current = setTimeout(() => {
        const d = dragRef.current;
        if (!d || d.active) return;
        d.armed = true;
        // Haptic feedback
        if (navigator.vibrate) navigator.vibrate(30);
        // Visual feedback: wiggle the card
        const el = scrollRef.current?.querySelector<HTMLElement>(`[data-gidx="${globalIndex}"]`);
        if (el) {
          el.classList.add('drag-ready');
          setTimeout(() => el.classList.remove('drag-ready'), 400);
        }
      }, 500);
    }
  }, []);

  const performReorder = useCallback(async (fromIdx: number, toInsertIdx: number) => {
    const to = toInsertIdx > fromIdx ? toInsertIdx - 1 : toInsertIdx;

    // True no-op: same position AND same day AND not creating new day
    if (to === fromIdx && !newDayRef.current) {
      const myDay = posts[fromIdx].basename.substring(0, 8);
      const nextDay = fromIdx < posts.length - 1 ? posts[fromIdx + 1].basename.substring(0, 8) : null;
      const prevDay = fromIdx > 0 ? posts[fromIdx - 1].basename.substring(0, 8) : null;
      const crossesDayBoundary = (!insertAboveDayRef.current && nextDay && nextDay !== myDay) ||
                                  (insertAboveDayRef.current && prevDay && prevDay !== myDay);
      if (!crossesDayBoundary) return;
    }

    // Clone all posts to ensure React detects changes (new object references)
    const newPosts = posts.map(p => ({ ...p }));
    const moved = newPosts.splice(fromIdx, 1)[0];
    newPosts.splice(to, 0, moved);

    const oldBasename = posts[fromIdx].basename;

    // Calculate new basename for the target position
    let newBasename = moved.basename;
    if (newPosts.length > 0) {
      let newDate: Date;
      const nd = newDayRef.current;

      if (nd === 'prev' && to === 0) {
        const firstDay = newPosts[to === 0 && newPosts.length > 1 ? 1 : 0].basename.substring(0, 8);
        const d = parseCustomDate(firstDay + '_120000');
        d.setDate(d.getDate() - 1);
        d.setHours(12, 0, 0);
        newDate = d;
      } else if (nd === 'next' && to >= newPosts.length - 1) {
        const lastPost = newPosts[to <= newPosts.length - 1 && to > 0 ? to - 1 : newPosts.length - 1];
        const lastDay = lastPost.basename.substring(0, 8);
        const d = parseCustomDate(lastDay + '_120000');
        d.setDate(d.getDate() + 1);
        d.setHours(12, 0, 0);
        newDate = d;
      } else if (to === 0) {
        const neighbor = newPosts.length > 1 ? newPosts[1] : newPosts[0];
        const nextTime = getTimeMs(neighbor.basename);
        const nextDayStart = parseCustomDate(neighbor.basename.substring(0, 8) + '_000000').getTime();
        newDate = new Date(Math.max(nextTime - 60000, nextDayStart));
      } else if (to === newPosts.length - 1) {
        const prevTime = getTimeMs(newPosts[to - 1].basename);
        const prevDayEnd = parseCustomDate(newPosts[to - 1].basename.substring(0, 8) + '_235900').getTime();
        newDate = new Date(Math.min(prevTime + 60000, prevDayEnd));
      } else {
        const prevTime = getTimeMs(newPosts[to - 1].basename);
        const nextTime = getTimeMs(newPosts[to + 1].basename);
        const prevDay = newPosts[to - 1].basename.substring(0, 8);
        const nextDay = newPosts[to + 1].basename.substring(0, 8);

        if (prevDay === nextDay) {
          newDate = new Date(Math.floor((prevTime + nextTime) / 2));
        } else if (insertAboveDayRef.current) {
          const prevDayEnd = parseCustomDate(prevDay + '_235900').getTime();
          newDate = new Date(Math.min(prevTime + 60000, prevDayEnd));
        } else {
          const nextDayStart = parseCustomDate(nextDay + '_000000').getTime();
          newDate = new Date(Math.max(nextTime - 60000, nextDayStart));
        }
      }
      newBasename = formatDateToCustom(newDate) + moved.basename.substring(15);
    }

    // Optimistic update: keep OLD basename so media URLs still work,
    // but reorder in array so position is correct visually
    setPosts(newPosts);

    // Flash the moved post
    setTimeout(() => {
      const el = scrollRef.current?.querySelector(`[data-gidx="${to}"]`);
      if (el) {
        el.classList.add('just-dropped');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        setTimeout(() => el.classList.remove('just-dropped'), 1600);
      }
    }, 30);

    try {
      // Send new basename to backend — it renames the folder
      const postToSend = { ...moved, basename: newBasename };
      await api.updatePost(currentChannel!, oldBasename, postToSend);
      // Refresh from backend — now folder is renamed, URLs are correct
      const refreshed = await api.getPosts(currentChannel!, { limit: Math.max(posts.length, PAGE_SIZE) });
      setPosts(refreshed);
    } catch (err) {
      console.error('Reorder failed:', err);
      // Revert on error
      const refreshed = await api.getPosts(currentChannel!, { limit: Math.max(posts.length, PAGE_SIZE) });
      setPosts(refreshed);
    }
  }, [posts, currentChannel, setPosts]);

  useEffect(() => {
    const createGhost = (fromIdx: number) => {
      const el = scrollRef.current?.querySelector<HTMLElement>(`[data-gidx="${fromIdx}"]`);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const ghost = document.createElement('div');
      ghost.className = 'drag-ghost';
      ghost.style.width = rect.width + 'px';
      ghost.style.position = 'fixed';
      ghost.style.zIndex = '9999';
      ghost.style.pointerEvents = 'none';
      ghost.style.transformOrigin = 'top right';
      ghost.style.transform = 'scale(0.35) rotate(-2deg)';
      ghost.style.opacity = '0.8';
      ghost.style.boxShadow = '0 6px 24px rgba(0,0,0,0.2)';
      ghost.style.borderRadius = '12px';
      ghost.style.overflow = 'hidden';
      ghost.style.transition = 'transform 0.2s cubic-bezier(0.2,0.8,0.2,1.1), opacity 0.15s';
      ghost.innerHTML = el.querySelector('.event-body')?.outerHTML || '';
      document.body.appendChild(ghost);
      ghostRef.current = ghost;
    };

    const moveGhost = (clientX: number, clientY: number) => {
      const ghost = ghostRef.current;
      if (!ghost) return;
      // Cursor pins to top-right corner of the miniature
      ghost.style.left = (clientX - ghost.offsetWidth) + 'px';
      ghost.style.top = (clientY - 4) + 'px';
    };

    const removeGhost = () => {
      if (ghostRef.current) {
        ghostRef.current.remove();
        ghostRef.current = null;
      }
    };

    // Auto-scroll: time-based smooth scroll near edges
    const EDGE_ZONE = 120; // px from edge where scrolling kicks in
    const MAX_SPEED = 600; // px per second at the very edge

    const getScrollSpeed = (clientY: number): number => {
      const sc = scrollRef.current;
      if (!sc) return 0;
      const rect = sc.getBoundingClientRect();
      const distTop = clientY - rect.top;
      const distBottom = rect.bottom - clientY;
      if (distTop < EDGE_ZONE && distTop >= 0) {
        const t = 1 - distTop / EDGE_ZONE; // 0 at threshold, 1 at edge
        return -t * t * t * MAX_SPEED;      // cubic ease-in, negative = scroll up
      }
      if (distBottom < EDGE_ZONE && distBottom >= 0) {
        const t = 1 - distBottom / EDGE_ZONE;
        return t * t * t * MAX_SPEED;
      }
      return 0;
    };

    const startAutoScroll = () => {
      if (autoScrollRef.current) return;
      let prevTime = performance.now();
      const tick = (now: number) => {
        const as = autoScrollRef.current;
        if (!as) return;
        const dt = Math.min((now - prevTime) / 1000, 0.05); // cap at 50ms to avoid jumps
        prevTime = now;
        const speed = getScrollSpeed(as.clientY);
        if (speed !== 0 && scrollRef.current) {
          scrollRef.current.scrollTop += speed * dt;
          // Recalculate insert position — only trigger re-render if changed
          const d = dragRef.current;
          if (d?.active) {
            const result = calcInsertY(as.clientY);
            const newIdx = result?.idx ?? null;
            const nd = result?.newDay ?? null;
            if (newIdx !== insertRef.current || (result && (result.aboveDayHeader !== insertAboveDayRef.current || nd !== newDayRef.current))) {
              insertRef.current = newIdx;
              insertAboveDayRef.current = result?.aboveDayHeader ?? false;
              newDayRef.current = nd;
              setInsertAtIdx(newIdx);
              setInsertAboveDay(result?.aboveDayHeader ?? false);
              setNewDayMode(nd);
            }
          }
        }
        as.raf = requestAnimationFrame(tick);
      };
      autoScrollRef.current = { raf: requestAnimationFrame(tick), clientY: 0 };
    };

    const stopAutoScroll = () => {
      if (autoScrollRef.current) {
        cancelAnimationFrame(autoScrollRef.current.raf);
        autoScrollRef.current = null;
      }
    };

    const handlePtrMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;

      // If not armed yet (waiting for long-press), cancel on significant movement
      if (!d.armed) {
        if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) > 10) {
          // Finger moved — this is a scroll, not a drag
          if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
          dragRef.current = null;
        }
        return;
      }

      if (!d.active) {
        if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 8) return;
        d.active = true;
        setDragFromIdx(d.fromIdx);
        createGhost(d.fromIdx);
        startAutoScroll();
        // Disable smooth scroll — it fights with rAF-based scrolling
        if (scrollRef.current) scrollRef.current.style.scrollBehavior = 'auto';
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
        document.body.style.touchAction = 'none';
      }
      e.preventDefault();
      // Update auto-scroll cursor position
      if (autoScrollRef.current) autoScrollRef.current.clientY = e.clientY;
      moveGhost(e.clientX, e.clientY);
      const result = calcInsertY(e.clientY);
      insertRef.current = result?.idx ?? null;
      insertAboveDayRef.current = result?.aboveDayHeader ?? false;
      newDayRef.current = result?.newDay ?? null;
      setInsertAtIdx(result?.idx ?? null);
      setInsertAboveDay(result?.aboveDayHeader ?? false);
      setNewDayMode(result?.newDay ?? null);
    };

    const handlePtrUp = () => {
      if (holdTimerRef.current) { clearTimeout(holdTimerRef.current); holdTimerRef.current = null; }
      stopAutoScroll();
      const d = dragRef.current;
      if (d?.active) {
        const pos = insertRef.current;
        if (pos !== null) performReorder(d.fromIdx, pos);
      }
      removeGhost();
      dragRef.current = null;
      insertRef.current = null;
      insertAboveDayRef.current = false;
      newDayRef.current = null;
      setDragFromIdx(null);
      setInsertAtIdx(null);
      setInsertAboveDay(false);
      setNewDayMode(null);
      // Restore smooth scroll
      if (scrollRef.current) scrollRef.current.style.scrollBehavior = '';
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      document.body.style.touchAction = '';
    };

    document.addEventListener('pointermove', handlePtrMove, { passive: false });
    document.addEventListener('pointerup', handlePtrUp);
    document.addEventListener('pointercancel', handlePtrUp);
    return () => {
      document.removeEventListener('pointermove', handlePtrMove);
      document.removeEventListener('pointerup', handlePtrUp);
      document.removeEventListener('pointercancel', handlePtrUp);
      stopAutoScroll();
      removeGhost();
    };
  }, [calcInsertY, performReorder]);

  // Scroll to post/date from URL, or to bottom on first load
  const initialScrollDone = useRef(false);
  useEffect(() => {
    // Reset on channel change
    initialScrollDone.current = false;
  }, [currentChannel]);

  useEffect(() => {
    if (posts.length === 0) return;
    const postBasename = searchParams.get('post');
    const dateKey = searchParams.get('date');
    if (postBasename) {
      setTimeout(() => {
        const el = document.getElementById(`post-${postBasename}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('highlight-flash');
          setTimeout(() => el.classList.remove('highlight-flash'), 3000);
        }
      }, 100);
      initialScrollDone.current = true;
    } else if (dateKey) {
      setTimeout(() => {
        const el = document.getElementById(`day-${dateKey}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          el.classList.add('highlight-flash');
          setTimeout(() => el.classList.remove('highlight-flash'), 3000);
        }
      }, 100);
      initialScrollDone.current = true;
    } else if (!initialScrollDone.current && scrollRef.current) {
      // First load: instant scroll to bottom, then enable loading after delay
      const sc = scrollRef.current;
      sc.style.scrollBehavior = 'auto';
      sc.scrollTop = sc.scrollHeight;
      sc.style.scrollBehavior = '';
      initialScrollDone.current = true;
      // Block load-more for 1.5s after initial render to prevent cascade
      loadCooldown.current = true;
      setTimeout(() => { loadCooldown.current = false; }, 1500);
    }
  }, [searchParams, posts, currentChannel]);

  // Load older posts when user scrolls near the top
  const loadCooldown = useRef(true);
  useEffect(() => { loadCooldown.current = true; }, [currentChannel]);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const handleScroll = () => {
      if (loadCooldown.current || loadingMore || !hasMorePosts || !currentChannel || searchQuery) return;
      if (sc.scrollTop < 100) {
        setLoadingMore(true);
        loadCooldown.current = true;
        const firstBasename = posts[0]?.basename;
        if (!firstBasename) { setLoadingMore(false); loadCooldown.current = false; return; }
        api.getPosts(currentChannel, { limit: PAGE_SIZE, before: firstBasename }).then(older => {
          if (older.length > 0) {
            // Disable smooth scroll, snapshot height
            sc.style.scrollBehavior = 'auto';
            const prevHeight = sc.scrollHeight;
            const prevTop = sc.scrollTop;

            // Force synchronous React render — DOM updates immediately
            flushSync(() => prependPosts(older));

            // Correct scroll position before browser paints
            sc.scrollTop = prevTop + (sc.scrollHeight - prevHeight);
            sc.style.scrollBehavior = '';
          }
          if (older.length < PAGE_SIZE) setHasMorePosts(false);
          setLoadingMore(false);
          setTimeout(() => { loadCooldown.current = false; }, 500);
        }).catch(() => { setLoadingMore(false); loadCooldown.current = false; });
      }
    };
    sc.addEventListener('scroll', handleScroll, { passive: true });
    return () => sc.removeEventListener('scroll', handleScroll);
  }, [loadingMore, hasMorePosts, currentChannel, posts, searchQuery, prependPosts, setHasMorePosts]);

  // Toggle a checkbox in post markdown text (- [ ] / - [x])
  const toggleCheckbox = useCallback(async (post: Post, checkIdx: number) => {
    let idx = 0;
    const newText = post.text.replace(/- \[([ x])\]/g, (match, state) => {
      if (idx++ === checkIdx) {
        return state === 'x' ? '- [ ]' : '- [x]';
      }
      return match;
    });
    if (newText === post.text) return;

    const updatedPost = { ...post, text: newText };
    const newPosts = posts.map(p => p.basename === post.basename ? updatedPost : p);
    setPosts(newPosts);

    try {
      await api.updatePost(currentChannel!, post.basename, updatedPost);
    } catch (err) {
      console.error('Checkbox update failed:', err);
      setPosts(posts);
    }
  }, [posts, currentChannel, setPosts]);

  // Attach checkbox listeners directly (event delegation doesn't work reliably for inputs)
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const handleCheckboxChange = (e: Event) => {
      const input = e.target as HTMLInputElement;
      if (input.type !== 'checkbox' || input.dataset.checkIdx == null) return;
      const checkIdx = parseInt(input.dataset.checkIdx);
      const postEl = input.closest('[data-gidx]') as HTMLElement;
      if (!postEl) return;
      const gidx = parseInt(postEl.dataset.gidx!);
      if (posts[gidx]) toggleCheckbox(posts[gidx], checkIdx);
    };

    container.addEventListener('change', handleCheckboxChange, true);
    return () => container.removeEventListener('change', handleCheckboxChange, true);
  }, [posts, toggleCheckbox]);

  // Handle hashtag clicks and code copy from rendered markdown
  const handleTimelineClick = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.classList.contains('hashtag') && target.dataset.tag) {
      setFilter(target.dataset.tag.toLowerCase());
    }
    if (target.classList.contains('code-copy') && target.dataset.code) {
      navigator.clipboard.writeText(target.dataset.code).then(() => {
        target.textContent = t('feed.copied');
        setTimeout(() => { target.textContent = t('feed.copy'); }, 1500);
      });
    }
  }, [setFilter]);

  return (
    <>
      {/* Search bar — shown when search is open */}
      {searchOpen && (
        <div className="search-bar-container">
          <input
            ref={searchInputRef}
            type="text"
            className="search-input"
            placeholder={t('feed.searchPlaceholder')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onBlur={() => { if (!searchQuery) setSearchOpen(false); }}
            autoFocus
          />
          <button className="search-clear" onClick={() => { setSearchQuery(''); setSearchOpen(false); }}>×</button>
        </div>
      )}

      {/* Header actions — rendered into header via portal */}
      {createPortal(
        <div className="header-actions">
          {(activeFilter !== 'all' || searchQuery) && (
            <button className="header-filter-badge" onClick={() => { setFilter('all'); setSearchQuery(''); setSearchOpen(false); }}>
              {searchQuery ? `"${searchQuery.substring(0, 12)}${searchQuery.length > 12 ? '…' : ''}"` : activeFilter} ×
            </button>
          )}
          {tags.length > 0 && (
            <div className="header-tags-wrap">
              <button className="head-btn" onPointerDown={(e) => { e.preventDefault(); setTagsOpen(!tagsOpen); }} title={t('feed.filters')}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
              </button>
              {tagsOpen && createPortal(
                <>
                  <div className="dropdown-backdrop" onPointerDown={() => setTagsOpen(false)} />
                  <div className="header-tags-dropdown show" style={{
                    position: 'fixed',
                    top: 52,
                    right: 12,
                  }}>
                    <div className={`header-tags-item${activeFilter === 'all' ? ' active' : ''}`}
                      onPointerUp={() => { setFilter('all'); setTagsOpen(false); }}>
                      {t('feed.allPosts')}
                    </div>
                    {tags.map(tag => (
                      <div key={tag} className={`header-tags-item${activeFilter === tag ? ' active' : ''}`}
                        onPointerUp={() => { setFilter(tag); setTagsOpen(false); }}>
                        {tag}
                      </div>
                    ))}
                  </div>
                </>,
                document.body
              )}
            </div>
          )}
          <button className="head-btn" onPointerDown={(e) => { e.preventDefault(); setSearchOpen(!searchOpen); }} title={t('feed.search')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
          </button>
        </div>,
        document.querySelector('.header-controls') || document.body
      )}

      <div className="chat-container" id="chat-scroll" ref={scrollRef} onClick={handleTimelineClick}>
        <div className={`timeline-container${dragFromIdx !== null ? ' reordering' : ''}`} id="timeline">
          {days.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              {posts.length === 0 ? t('feed.noPosts') : searchQuery ? t('feed.notFound') : t('feed.noPostsWithTag')}
            </div>
          )}
          {loadingMore && (
            <div style={{ padding: '12px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              {t('feed.loading')}
            </div>
          )}
          {hasMorePosts && !loadingMore && posts.length > 0 && (
            <div style={{ padding: '8px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              {t('feed.scrollUp')}
            </div>
          )}
          {newDayMode === 'prev' && (
            <div className="new-day-placeholder">
              <div className="new-day-line" />
              <span className="new-day-label">{t('feed.newDay')}</span>
              <div className="new-day-line" />
            </div>
          )}
          {days.map(([dayKey, items]) => (
            <DayGroup
              key={dayKey}
              dayKey={dayKey}
              items={items}
              dragFromIdx={dragFromIdx}
              insertAtIdx={insertAtIdx}
              insertAboveDay={insertAboveDay}
              postsCount={posts.length}
              onDragHandleDown={handleDragHandleDown}
            />
          ))}
          {newDayMode === 'next' && (
            <div className="new-day-placeholder">
              <div className="new-day-line" />
              <span className="new-day-label">{t('feed.newDay')}</span>
              <div className="new-day-line" />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ============================================================
 * DayGroup
 * ============================================================ */

function DayGroup({ dayKey, items, dragFromIdx, insertAtIdx, insertAboveDay, postsCount, onDragHandleDown }: {
  dayKey: string;
  items: { post: Post; globalIndex: number }[];
  dragFromIdx: number | null;
  insertAtIdx: number | null;
  insertAboveDay: boolean;
  postsCount: number;
  onDragHandleDown: (globalIndex: number, clientX: number, clientY: number, pointerType: string) => void;
}) {
  const { t } = useTranslation();
  const { currentChannel } = useAppStore();
  const [linkCopied, setLinkCopied] = useState(false);

  const { i18n: { language: lang } } = useTranslation();
  const displayDate = useMemo(() => {
    const d = new Date(
      parseInt(dayKey.substring(0, 4)),
      parseInt(dayKey.substring(4, 6)) - 1,
      parseInt(dayKey.substring(6, 8)),
    );
    const locale = lang === 'ru' ? 'ru-RU' : 'en-US';
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', weekday: 'long' });
  }, [dayKey, lang]);

  const handleDateClick = () => {
    const url = `${window.location.origin}/c/${currentChannel}?date=${dayKey}`;
    copyToClipboard(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1200);
    });
  };

  return (
    <div className="day-card" id={`day-${dayKey}`}>
      <div
        className={`day-header${linkCopied ? ' link-copied' : ''}`}
        data-day-first={items[0].globalIndex}
        onClick={handleDateClick}
        title={t('feed.copyDateLink')}
      >
        <span className="day-header-dot" />
        <span className="day-header-text">
          {displayDate}
          <span className="day-header-count">·{items.length}</span>
        </span>
      </div>
      <div className="day-content">
        {items.map(({ post, globalIndex }) => (
          <PostCard
            key={post.basename}
            post={post}
            globalIndex={globalIndex}
            isDragged={dragFromIdx === globalIndex}
            showDropAbove={insertAtIdx === globalIndex && !insertAboveDay && dragFromIdx !== globalIndex}
            showDropBelow={
              (insertAtIdx === postsCount && globalIndex === items[items.length - 1].globalIndex && dragFromIdx !== globalIndex) ||
              (insertAboveDay && insertAtIdx !== null && insertAtIdx > 0 && globalIndex === insertAtIdx - 1 && dragFromIdx !== globalIndex)
            }
            showGapEnd={insertAtIdx !== null && insertAtIdx > 0 && globalIndex === insertAtIdx - 1 && !insertAboveDay && dragFromIdx !== globalIndex}
            onDragHandleDown={onDragHandleDown}
          />
        ))}
      </div>
    </div>
  );
}

/* ============================================================
 * PostCard
 * ============================================================ */

function PostCard({ post, globalIndex, isDragged, showDropAbove, showDropBelow, showGapEnd, onDragHandleDown }: {
  post: Post;
  globalIndex: number;
  isDragged: boolean;
  showDropAbove: boolean;
  showDropBelow: boolean;
  showGapEnd: boolean;
  onDragHandleDown: (globalIndex: number, clientX: number, clientY: number, pointerType: string) => void;
}) {
  const { t } = useTranslation();
  const { currentChannel, showMeta, startEdit, setPosts, posts: allPosts, openLightbox } = useAppStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const [dateEditing, setDateEditing] = useState(false);

  const time = formatTime(post.basename);

  // Split files into media (photos/videos) and attachments (documents)
  const mediaFiles = useMemo(() => post.files.filter(f => f.type !== 'file'), [post.files]);
  const attachments = useMemo(() => post.files.filter(f => f.type === 'file'), [post.files]);

  const hasMedia = mediaFiles.length > 0;
  const hasAttachments = attachments.length > 0;
  const isCompact = (
    (!hasMedia && !hasAttachments && !post.text && !!post.title && post.title.length < 150 && !post.title.includes('\n')) ||
    (!hasMedia && !hasAttachments && !post.title && post.text.length < 150 && !post.text.includes('\n'))
  );
  const isMediaOnly = !post.title && !post.text && hasMedia && !hasAttachments;
  const isSingleMedia = mediaFiles.length === 1;
  const isCaptionedMedia = !!post.title && !post.text && hasMedia && !hasAttachments;

  const formattedTitle = useMemo(() => renderMarkdown(post.title || ''), [post.title]);
  const formattedText = useMemo(() => renderMarkdown(post.text), [post.text]);
  const mdContent = useMemo(() => generateMarkdownContent(post), [post]);

  const handleTimeClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/c/${currentChannel}?post=${post.basename}`;
    copyToClipboard(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1200);
    });
  };

  const handleDelete = async () => {
    if (!confirm(t('feed.deleteConfirm'))) return;
    try {
      await api.deletePost(currentChannel!, post.basename);
      const updated = await api.getPosts(currentChannel!, { limit: Math.max(allPosts.length, PAGE_SIZE) });
      setPosts(updated);
    } catch (e: any) { alert(e.message); }
    setMenuOpen(false);
  };

  const handleEdit = () => {
    startEdit(post, globalIndex);
    setMenuOpen(false);
  };

  const handleDateChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = new Date(e.target.value);
    if (isNaN(newDate.getTime())) return;
    const newBasename = formatDateToCustom(newDate) + post.basename.substring(15);
    try {
      await api.updatePost(currentChannel!, post.basename, { ...post, basename: newBasename });
      const updated = await api.getPosts(currentChannel!, { limit: Math.max(allPosts.length, PAGE_SIZE) });
      setPosts(updated);
    } catch (e: any) { alert(e.message); }
    setDateEditing(false);
    setMenuOpen(false);
  };

  const handleMediaClick = (fileIndex: number) => {
    openLightbox(globalIndex, fileIndex);
  };

  const handleDragDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    onDragHandleDown(globalIndex, e.clientX, e.clientY, e.pointerType);
  }, [globalIndex, onDragHandleDown]);

  const eventClasses = [
    'event',
    isCompact ? 'compact' : '',
    isMediaOnly ? 'media-only' : '',
    isSingleMedia ? 'single-media' : '',
    isCaptionedMedia ? 'captioned-media' : '',
    post.hidden ? 'is-hidden' : '',
    isDragged ? 'is-dragged' : '',
    showDropAbove ? 'drop-above' : '',
    showDropBelow ? 'drop-below' : '',
    showGapEnd ? 'drop-gap-end' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={eventClasses}
      id={`post-${post.basename}`}
      data-gidx={globalIndex}
    >
      <span
        className={`event-time${linkCopied ? ' link-copied' : ''}`}
        title={t('feed.copyLink')}
        style={{ cursor: 'pointer' }}
        onClick={handleTimeClick}
      >
        {linkCopied ? '✓' : time}
      </span>

      <div className="event-body">
        {isCompact ? (
          /* Compact layout */
          <>
            <div className="post-header">
              <div className="event-text" dangerouslySetInnerHTML={{ __html: formattedTitle || formattedText }} />
              {post.hidden && <span className="post-hidden-badge">{t('feed.hidden')}</span>}
              <PostControls
                menuOpen={menuOpen}
                setMenuOpen={setMenuOpen}
                onEdit={handleEdit}
                onDelete={handleDelete}
                dateEditing={dateEditing}
                setDateEditing={setDateEditing}
                onDateChange={handleDateChange}
                basename={post.basename}
                onDragDown={handleDragDown}
              />
            </div>
            {post.author && <div className="post-author">{post.author}</div>}
          </>
        ) : isCaptionedMedia ? (
          /* Captioned media — same glass header, media below */
          <>
            <div className="post-header">
              <h3 className="post-title">
                <span dangerouslySetInnerHTML={{ __html: formattedTitle }} />
              </h3>
              <PostControls
                menuOpen={menuOpen}
                setMenuOpen={setMenuOpen}
                onEdit={handleEdit}
                onDelete={handleDelete}
                dateEditing={dateEditing}
                setDateEditing={setDateEditing}
                onDateChange={handleDateChange}
                basename={post.basename}
                onDragDown={handleDragDown}
              />
            </div>
            <div className="captioned-content">
              <PostMedia files={mediaFiles} post={post} onMediaClick={handleMediaClick} />
            </div>
            {post.author && <div className="post-author">{post.author}</div>}
          </>
        ) : (
          /* Full layout */
          <>
            <div className="post-header">
              {post.title && (
                <h3 className="post-title">
                  <span dangerouslySetInnerHTML={{ __html: formattedTitle }} />
                  {post.hidden && <span className="post-hidden-badge"> {t('feed.hidden')}</span>}
                </h3>
              )}
              <PostControls
                menuOpen={menuOpen}
                setMenuOpen={setMenuOpen}
                onEdit={handleEdit}
                onDelete={handleDelete}
                dateEditing={dateEditing}
                setDateEditing={setDateEditing}
                onDateChange={handleDateChange}
                basename={post.basename}
                onDragDown={handleDragDown}
              />
            </div>
            {post.text && <div className="post-text" dangerouslySetInnerHTML={{ __html: formattedText }} />}
            {hasAttachments && <FileAttachments files={attachments} post={post} />}
            {hasMedia && (
              <PostMedia files={mediaFiles} post={post} onMediaClick={handleMediaClick} />
            )}
            {post.author && <div className="post-author">{post.author}</div>}
          </>
        )}
      </div>

      {/* Service data (Src view) */}
      {showMeta && (
        <div className="post-service-data">
          <div className="service-folder-name">📁 /{currentChannel}/{post.basename}/</div>
          <span className="service-file-label">📄 {post.basename}.md</span>
          <textarea className="service-textarea" readOnly value={mdContent} />
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * PostControls — drag handle + dropdown menu
 * ============================================================ */

function PostControls({ menuOpen, setMenuOpen, onEdit, onDelete, dateEditing, setDateEditing, onDateChange, basename, onDragDown }: {
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
  dateEditing: boolean;
  setDateEditing: (editing: boolean) => void;
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  basename: string;
  onDragDown: (e: React.PointerEvent) => void;
}) {
  const { t } = useTranslation();
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  const isMobile = window.matchMedia('(max-width: 768px)').matches;

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    // Block clicks for 400ms after close to prevent pass-through to content below
    const blocker = document.createElement('div');
    blocker.style.cssText = 'position:fixed;inset:0;z-index:9998;';
    document.body.appendChild(blocker);
    setTimeout(() => blocker.remove(), 400);
  }, [setMenuOpen]);

  const handleMenuToggle = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (menuOpen) {
      closeMenu();
      return;
    }
    if (!isMobile) {
      const btn = menuBtnRef.current;
      if (btn) {
        const rect = btn.getBoundingClientRect();
        setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
      }
    } else {
      setMenuPos(null);
    }
    setMenuOpen(true);
  }, [menuOpen, setMenuOpen, closeMenu, isMobile]);

  return (
    <div className="post-controls">
      <div className="drag-handle" title={t('feed.drag')} onPointerDown={onDragDown}>⋮⋮</div>
      <button
        ref={menuBtnRef}
        className="menu-btn"
        title={t('feed.menu')}
        onPointerDown={handleMenuToggle}
      >
        ⋮
      </button>
      {menuOpen && createPortal(
        <>
          <div
            className={`dropdown-backdrop${isMobile ? ' visible' : ''}`}
            onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); closeMenu(); }}
          />
          <div
            className={`dropdown-menu show${isMobile ? ' mobile' : ''}`}
            style={menuPos ? { position: 'fixed', top: menuPos.top, right: menuPos.right } : undefined}
            onClick={e => e.stopPropagation()}
          >
            <div className="dropdown-item" onPointerUp={() => { closeMenu(); onEdit(); }}>{t('feed.editItem')}</div>
            <div className="dropdown-item" onPointerUp={() => { setDateEditing(true); closeMenu(); }}>{t('feed.timeItem')}</div>
            <div className="dropdown-item danger" onPointerUp={() => { closeMenu(); onDelete(); }}>{t('feed.deleteItem')}</div>
          </div>
        </>,
        document.body
      )}
      {dateEditing && createPortal(
        <PostDatePicker
          basename={basename}
          anchorRef={menuBtnRef}
          onDateChange={onDateChange}
          onClose={() => setDateEditing(false)}
        />,
        document.body
      )}
    </div>
  );
}

/* Inline date picker for editing post date — same approach as Composer DatePicker */
function PostDatePicker({ basename, anchorRef, onDateChange, onClose }: {
  basename: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  onDateChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onClose: () => void;
}) {
  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  const fpRef = useRef<any>(null);

  useEffect(() => {
    const currentDate = parseCustomDate(basename);
    const pad = (n: number) => String(n).padStart(2, '0');
    const toIso = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    if (isMobile) {
      const input = document.createElement('input');
      input.type = 'datetime-local';
      input.value = formatDateForInput(currentDate);
      input.style.cssText = 'position:fixed;top:50%;left:50%;opacity:0;width:1px;height:1px';
      document.body.appendChild(input);
      let changed = false;
      input.addEventListener('change', () => {
        changed = true;
        onDateChange({ target: { value: input.value } } as any);
        input.remove();
        onClose();
      });
      // On Android, blur fires when system picker opens — ignore it
      // Only clean up on blur if picker was dismissed without change (long delay)
      input.addEventListener('blur', () => {
        setTimeout(() => { if (!changed && document.body.contains(input)) { input.remove(); onClose(); } }, 3000);
      });
      setTimeout(() => { input.focus(); input.click(); }, 100);
      return () => { if (document.body.contains(input)) input.remove(); };
    }

    // Hidden input for flatpickr — appended to body
    const input = document.createElement('input');
    input.type = 'text';
    input.style.cssText = 'position:fixed;top:-100px;opacity:0;width:0;height:0';
    document.body.appendChild(input);

    let pendingDate = formatDateForInput(currentDate);

    const fp = flatpickr(input, {
      enableTime: true,
      time_24hr: true,
      locale: 'ru',
      dateFormat: 'j M, H:i',
      defaultDate: currentDate,
      closeOnSelect: false,
      onChange: ([date]: Date[], _: string, inst: any) => {
        if (date) pendingDate = toIso(date);
        if (inst.hourElement) inst.hourElement.blur();
        if (inst.minuteElement) inst.minuteElement.blur();
      },
      onReady: (_: any, __: string, inst: any) => {
        inst.close = () => {};

        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'flatpickr-ok-btn';
        okBtn.textContent = 'OK';
        okBtn.addEventListener('click', () => {
          onDateChange({ target: { value: pendingDate } } as any);
          cleanup();
          onClose();
        });
        inst.calendarContainer.appendChild(okBtn);

        inst.calendarContainer.querySelectorAll('.flatpickr-time .numInputWrapper').forEach((wrapper: HTMLElement) => {
          wrapper.querySelectorAll<HTMLElement>('.arrowUp, .arrowDown').forEach(a => a.style.display = 'none');
          const inp = wrapper.querySelector('input') as HTMLInputElement;
          if (!inp) return;
          const max = inp.max ? parseInt(inp.max) : (inp.className.includes('flatpickr-hour') ? 23 : 59);

          const btnUp = document.createElement('button');
          btnUp.type = 'button';
          btnUp.className = 'time-step-btn time-step-up';
          btnUp.textContent = '+';
          btnUp.addEventListener('click', (e) => { e.preventDefault(); let v = parseInt(inp.value||'0')+1; if(v>max)v=0; inp.value=String(v).padStart(2,'0'); inp.dispatchEvent(new Event('input',{bubbles:true})); });

          const btnDown = document.createElement('button');
          btnDown.type = 'button';
          btnDown.className = 'time-step-btn time-step-down';
          btnDown.textContent = '−';
          btnDown.addEventListener('click', (e) => { e.preventDefault(); let v = parseInt(inp.value||'0')-1; if(v<0)v=max; inp.value=String(v).padStart(2,'0'); inp.dispatchEvent(new Event('input',{bubbles:true})); });

          wrapper.insertBefore(btnUp, wrapper.firstChild);
          wrapper.appendChild(btnDown);

          inp.addEventListener('wheel', (e: WheelEvent) => { e.preventDefault(); let v=parseInt(inp.value||'0')+(e.deltaY<0?1:-1); if(v<0)v=max; if(v>max)v=0; inp.value=String(v).padStart(2,'0'); inp.dispatchEvent(new Event('input',{bubbles:true})); }, { passive: false });
        });

        const days = inst.calendarContainer.querySelector('.flatpickr-days');
        if (days) days.addEventListener('wheel', (e: WheelEvent) => { e.preventDefault(); inst.changeMonth(e.deltaY>0?1:-1); }, { passive: false });
        const monthSel = inst.calendarContainer.querySelector('.flatpickr-monthDropdown-months');
        if (monthSel) monthSel.addEventListener('wheel', (e: WheelEvent) => { e.preventDefault(); inst.changeMonth(e.deltaY>0?1:-1); }, { passive: false });
        const yearInp = inst.calendarContainer.querySelector('.cur-year');
        if (yearInp) yearInp.addEventListener('wheel', (e: WheelEvent) => { e.preventDefault(); inst.changeYear(inst.currentYear+(e.deltaY<0?1:-1)); }, { passive: false });
      },
    });

    fpRef.current = fp;
    fp.open();

    // Center calendar on screen after flatpickr renders it in body
    requestAnimationFrame(() => {
      const cal = fp.calendarContainer as HTMLElement;
      if (!cal) return;
      const h = cal.offsetHeight;
      const w = cal.offsetWidth;
      cal.style.position = 'fixed';
      cal.style.top = Math.max(8, Math.round((window.innerHeight - h) / 2)) + 'px';
      cal.style.left = Math.max(8, Math.round((window.innerWidth - w) / 2)) + 'px';
      cal.style.margin = '0';
      cal.style.zIndex = '10001';
    });

    const cleanup = () => {
      fp.destroy();
      input.remove();
    };

    return cleanup;
  }, [basename, isMobile, onDateChange, onClose]);

  if (isMobile) return null;

  return (
    <div className="dropdown-backdrop visible" onPointerDown={(e) => { e.preventDefault(); e.stopPropagation(); onClose(); }} />
  );
}

/* ============================================================
 * PostMedia — медиа-сетка
 * ============================================================ */

/* ============================================================
 * FileAttachments — document/file chips (Telegram style)
 * ============================================================ */

const FILE_ICONS: Record<string, { icon: string; color: string }> = {
  pdf: { icon: '📕', color: '#e74c3c' },
  doc: { icon: '📘', color: '#2980b9' }, docx: { icon: '📘', color: '#2980b9' },
  xls: { icon: '📗', color: '#27ae60' }, xlsx: { icon: '📗', color: '#27ae60' }, csv: { icon: '📗', color: '#27ae60' },
  ppt: { icon: '📙', color: '#e67e22' }, pptx: { icon: '📙', color: '#e67e22' },
  zip: { icon: '📦', color: '#f39c12' }, rar: { icon: '📦', color: '#f39c12' }, '7z': { icon: '📦', color: '#f39c12' },
  tar: { icon: '📦', color: '#f39c12' }, gz: { icon: '📦', color: '#f39c12' },
  mp3: { icon: '🎵', color: '#8e44ad' }, wav: { icon: '🎵', color: '#8e44ad' }, ogg: { icon: '🎵', color: '#8e44ad' },
  txt: { icon: '📄', color: '#7f8c8d' }, json: { icon: '📄', color: '#7f8c8d' }, xml: { icon: '📄', color: '#7f8c8d' },
  py: { icon: '🐍', color: '#3498db' }, js: { icon: '📜', color: '#f1c40f' }, ts: { icon: '📜', color: '#3498db' },
  html: { icon: '🌐', color: '#e67e22' }, css: { icon: '🎨', color: '#2980b9' },
};

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return FILE_ICONS[ext] || { icon: '📄', color: '#95a5a6' };
}

function FileAttachments({ files, post }: { files: MediaFile[]; post: Post }) {
  const { currentChannel } = useAppStore();

  return (
    <div className="file-attachments">
      {files.map(file => {
        const { icon, color } = getFileIcon(file.name);
        const url = file.url || api.getMediaUrl(currentChannel!, post, file);
        return (
          <a
            key={file.name}
            className="file-chip"
            href={url}
            download={file.name}
            target="_blank"
            rel="noopener"
          >
            <span className="file-chip-icon" style={{ backgroundColor: color }}>{icon}</span>
            <span className="file-chip-info">
              <span className="file-chip-name">{file.name}</span>
              {file.size != null && <span className="file-chip-size">{formatBytes(file.size)}</span>}
            </span>
            <span className="file-chip-download">↓</span>
          </a>
        );
      })}
    </div>
  );
}

function PostMedia({ files, post, onMediaClick }: {
  files: MediaFile[];
  post: Post;
  onMediaClick: (index: number) => void;
}) {
  const { currentChannel } = useAppStore();
  const gridClass = getMediaGridClass(files.length);

  return (
    <div className={`post-media ${gridClass}`}>
      {files.map((file, i) => {
        const url = file.url || api.getMediaUrl(currentChannel!, post, file);
        const thumbUrl = file.url || api.getMediaUrl(currentChannel!, post, file, true);
        return (
          <div
            key={file.name}
            className={`media-wrapper${isVideo(file.name) ? ' media-video' : ''}`}
            onClick={() => onMediaClick(i)}
          >
            <div className="media-order-badge">{i + 1}</div>
            {isVideo(file.name) ? (
              <>
                <img src={thumbUrl} alt={file.name} loading="lazy" />
                <div className="video-play-badge">▶</div>
              </>
            ) : (
              <img src={thumbUrl} alt={file.name} loading="lazy" />
            )}
          </div>
        );
      })}
    </div>
  );
}
