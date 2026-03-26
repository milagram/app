/**
 * Lightbox.tsx — Fullscreen media viewer
 *
 * Features:
 * - Image / Video display
 * - Navigation ←→ (buttons, arrows, swipes)
 * - Slide animation on switch
 * - PC: wheel zoom, double-click zoom, mouse drag pan
 * - Mobile: pinch-to-zoom, double-tap, touch drag pan, swipe navigate
 * - Keyboard: Escape, Arrow keys
 */

import { useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './store';
import { api } from './api';
import { isVideo } from './utils';

/* ============================================================
 * Lightbox
 * ============================================================ */

export function Lightbox() {
  const { t } = useTranslation();
  const { lightbox, closeLightbox, setLightboxIndex, posts, currentChannel } = useAppStore();
  const { isOpen, postIndex, fileIndex } = lightbox;

  const overlayRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Zoom/pan state (refs to avoid re-renders during gestures)
  const zoom = useRef(1);
  const panX = useRef(0);
  const panY = useRef(0);
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });
  const animating = useRef(false);
  const lastPinch = useRef({ dist: 0, cx: 0, cy: 0 });
  const touchStart = useRef({ x: 0, y: 0, moved: false });
  const lastTapTime = useRef(0);
  const lastClickTime = useRef(0);

  const post = isOpen ? posts[postIndex] : null;
  const file = post?.files[fileIndex];
  const totalFiles = post?.files.length || 0;

  /* --- Helpers --- */

  const getUrl = useCallback((f: typeof file) => {
    if (!f || !currentChannel || !post) return '';
    return f.url || api.getMediaUrl(currentChannel, post, f);
  }, [currentChannel, post]);

  const applyZoomTransform = useCallback(() => {
    const el = imgRef.current;
    if (!el) return;
    if (zoom.current <= 1) {
      el.style.transform = '';
      el.style.cursor = '';
    } else {
      el.style.transform = `translate(${panX.current}px, ${panY.current}px) scale(${zoom.current})`;
      el.style.cursor = 'grab';
    }
    overlayRef.current?.classList.toggle('zoomed', zoom.current > 1);
  }, []);

  const clampPan = useCallback(() => {
    if (zoom.current <= 1) { panX.current = 0; panY.current = 0; return; }
    const el = imgRef.current;
    const body = bodyRef.current;
    if (!el || !body) return;
    const rect = body.getBoundingClientRect();
    const maxX = Math.max(0, (el.offsetWidth * zoom.current - rect.width) / 2);
    const maxY = Math.max(0, (el.offsetHeight * zoom.current - rect.height) / 2);
    panX.current = Math.max(-maxX, Math.min(maxX, panX.current));
    panY.current = Math.max(-maxY, Math.min(maxY, panY.current));
  }, []);

  const resetZoom = useCallback(() => {
    zoom.current = 1;
    panX.current = 0;
    panY.current = 0;
    applyZoomTransform();
  }, [applyZoomTransform]);

  const zoomTo = useCallback((newZoom: number, clientX: number, clientY: number) => {
    const body = bodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    const oldZoom = zoom.current;
    newZoom = Math.max(1, Math.min(5, newZoom));
    if (oldZoom !== newZoom) {
      const ratio = newZoom / oldZoom;
      panX.current = cx - ratio * (cx - panX.current);
      panY.current = cy - ratio * (cy - panY.current);
    }
    zoom.current = newZoom;
    if (newZoom <= 1) { panX.current = 0; panY.current = 0; }
    clampPan();
    applyZoomTransform();
  }, [clampPan, applyZoomTransform]);

  /* --- Navigate with slide animation --- */
  const navigate = useCallback((dir: number) => {
    if (!post || animating.current || zoom.current > 1) return;
    const newIdx = fileIndex + dir;
    if (newIdx < 0 || newIdx >= post.files.length) return;

    resetZoom();
    animating.current = true;

    if (videoRef.current) videoRef.current.pause();

    const body = bodyRef.current;
    if (!body) return;
    const W = body.getBoundingClientRect().width;

    // Clone current media for outgoing slide
    const currentFile = post.files[fileIndex];
    const currentUrl = getUrl(currentFile);
    const clone = document.createElement(isVideo(currentFile.name) ? 'video' : 'img');
    clone.className = 'lightbox-slide-clone';
    (clone as any).src = currentUrl;
    if (isVideo(currentFile.name)) (clone as HTMLVideoElement).muted = true;
    else (clone as HTMLImageElement).draggable = false;
    body.appendChild(clone);

    // Update state to new file
    setLightboxIndex(postIndex, newIdx);

    // Animate: determine the real element (img or video)
    const nextFile = post.files[newIdx];
    const realEl = isVideo(nextFile.name) ? videoRef.current : imgRef.current;
    if (!realEl) { animating.current = false; return; }

    // Position without transition
    clone.style.transition = 'none';
    realEl.style.transition = 'none';
    clone.style.transform = 'translateX(0)';
    realEl.style.transform = `translateX(${dir > 0 ? W : -W}px)`;
    clone.offsetHeight; // force reflow

    // Animate both
    const t = '0.3s cubic-bezier(0.4, 0, 0.2, 1)';
    clone.style.transition = `transform ${t}, opacity ${t}`;
    realEl.style.transition = `transform ${t}`;
    clone.style.transform = `translateX(${dir > 0 ? -W : W}px)`;
    clone.style.opacity = '0.3';
    realEl.style.transform = 'translateX(0)';

    setTimeout(() => {
      clone.remove();
      realEl.style.transition = '';
      realEl.style.transform = '';
      animating.current = false;
    }, 300);
  }, [post, fileIndex, postIndex, resetZoom, getUrl, setLightboxIndex]);

  /* --- Body overflow lock --- */
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      resetZoom();
      setTimeout(() => overlayRef.current?.focus(), 50);
    } else {
      document.body.style.overflow = '';
      if (videoRef.current) {
        videoRef.current.pause();
        videoRef.current.currentTime = 0;
      }
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen, resetZoom]);

  /* --- Back button closes lightbox (Android / browser history) --- */
  useEffect(() => {
    if (!isOpen) return;
    let closedByBack = false;
    history.pushState({ lightbox: true }, '');
    const onPopState = () => {
      closedByBack = true;
      closeLightbox();
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      window.removeEventListener('popstate', onPopState);
      // Closed by × / Escape / swipe — remove the fake history entry
      if (!closedByBack) history.back();
    };
  }, [isOpen, closeLightbox]);

  /* --- Reset zoom on file change --- */
  useEffect(() => {
    if (isOpen) resetZoom();
  }, [fileIndex, isOpen, resetZoom]);

  /* --- Auto-play video --- */
  useEffect(() => {
    if (isOpen && file && isVideo(file.name) && videoRef.current) {
      videoRef.current.currentTime = 0;
      videoRef.current.play().catch(() => {});
    }
  }, [isOpen, file, fileIndex]);

  /* --- Mouse events (wheel, drag, double-click) --- */
  useEffect(() => {
    if (!isOpen) return;
    const body = bodyRef.current;
    if (!body) return;

    const handleWheel = (e: WheelEvent) => {
      if (!file || isVideo(file.name)) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.25 : 0.25;
      zoomTo(zoom.current + delta, e.clientX, e.clientY);
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (zoom.current <= 1 || e.target !== imgRef.current) return;
      e.preventDefault();
      isPanning.current = true;
      panStart.current = { x: e.clientX, y: e.clientY };
      panOrigin.current = { x: panX.current, y: panY.current };
      if (imgRef.current) imgRef.current.style.cursor = 'grabbing';
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isPanning.current) return;
      panX.current = panOrigin.current.x + (e.clientX - panStart.current.x);
      panY.current = panOrigin.current.y + (e.clientY - panStart.current.y);
      clampPan();
      applyZoomTransform();
    };

    const handleMouseUp = () => {
      if (isPanning.current) {
        isPanning.current = false;
        if (imgRef.current && zoom.current > 1) imgRef.current.style.cursor = 'grab';
      }
    };

    body.addEventListener('wheel', handleWheel, { passive: false });
    body.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      body.removeEventListener('wheel', handleWheel);
      body.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isOpen, file, zoomTo, clampPan, applyZoomTransform]);

  /* --- Touch events (pinch, drag, double-tap, swipe) --- */
  useEffect(() => {
    if (!isOpen) return;
    const body = bodyRef.current;
    if (!body) return;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastPinch.current = {
          dist: Math.hypot(dx, dy),
          cx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
          cy: (e.touches[0].clientY + e.touches[1].clientY) / 2,
        };
      } else if (e.touches.length === 1) {
        touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false };
        if (zoom.current > 1) {
          isPanning.current = true;
          panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
          panOrigin.current = { x: panX.current, y: panY.current };
        }
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2 && file && !isVideo(file.name)) {
        e.preventDefault();
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        if (lastPinch.current.dist > 0) {
          const scale = dist / lastPinch.current.dist;
          zoomTo(zoom.current * scale, cx, cy);
        }
        lastPinch.current = { dist, cx, cy };
      } else if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchStart.current.x;
        const dy = e.touches[0].clientY - touchStart.current.y;
        if (Math.abs(dx) > 5 || Math.abs(dy) > 5) touchStart.current.moved = true;
        if (isPanning.current && zoom.current > 1) {
          e.preventDefault();
          panX.current = panOrigin.current.x + (e.touches[0].clientX - panStart.current.x);
          panY.current = panOrigin.current.y + (e.touches[0].clientY - panStart.current.y);
          clampPan();
          applyZoomTransform();
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      lastPinch.current.dist = 0;
      isPanning.current = false;
      if (e.touches.length === 0 && e.changedTouches.length === 1) {
        const dx = e.changedTouches[0].clientX - touchStart.current.x;
        // Double-tap
        if (!touchStart.current.moved) {
          const now = Date.now();
          if (now - lastTapTime.current < 300) {
            e.preventDefault();
            if (zoom.current > 1) resetZoom();
            else zoomTo(2.5, e.changedTouches[0].clientX, e.changedTouches[0].clientY);
            lastTapTime.current = 0;
            return;
          }
          lastTapTime.current = now;
        }
        // Swipe navigate
        if (zoom.current <= 1 && Math.abs(dx) > 60 && touchStart.current.moved) {
          navigate(dx > 0 ? -1 : 1);
        }
      }
    };

    body.addEventListener('touchstart', handleTouchStart, { passive: false });
    body.addEventListener('touchmove', handleTouchMove, { passive: false });
    body.addEventListener('touchend', handleTouchEnd);
    return () => {
      body.removeEventListener('touchstart', handleTouchStart);
      body.removeEventListener('touchmove', handleTouchMove);
      body.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isOpen, file, zoomTo, clampPan, applyZoomTransform, resetZoom, navigate]);

  if (!isOpen || !post || !file) return null;

  const url = getUrl(file);
  const isVid = isVideo(file.name);

  /* --- Click handlers --- */
  const handleBodyClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    // If zoomed, click on image/body resets zoom
    if (zoom.current > 1 && (target === bodyRef.current || target === imgRef.current)) {
      e.stopPropagation();
      resetZoom();
      return;
    }
    // Click on empty area (body background, not on img/video/nav) → close
    if (target === bodyRef.current) {
      closeLightbox();
      return;
    }
    // Double-click to zoom
    if (target === imgRef.current || target === bodyRef.current) {
      const now = Date.now();
      if (now - lastClickTime.current < 300) {
        e.stopPropagation();
        zoomTo(2.5, e.clientX, e.clientY);
        lastClickTime.current = 0;
      } else {
        lastClickTime.current = now;
      }
    }
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (zoom.current > 1) return;
    if (e.target === overlayRef.current) closeLightbox();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (zoom.current > 1) resetZoom(); else closeLightbox();
    }
    if (zoom.current > 1) return;
    if (e.key === 'ArrowLeft') navigate(-1);
    if (e.key === 'ArrowRight') navigate(1);
  };

  return (
    <div
      ref={overlayRef}
      className="lightbox-overlay active"
      tabIndex={0}
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
    >
      <div className="lightbox-header">
        <span className="lightbox-counter">{fileIndex + 1} / {totalFiles}</span>
        <div className="lightbox-actions">
          <a
            className="lightbox-download"
            href={url}
            download={file.name}
            title={t('lightbox.download')}
            onClick={e => e.stopPropagation()}
          >↓</a>
          <button className="lightbox-close" onClick={closeLightbox}>×</button>
        </div>
      </div>
      <div ref={bodyRef} className="lightbox-body" onClick={handleBodyClick}>
        <button
          className="lightbox-nav lightbox-prev"
          style={{ visibility: fileIndex > 0 ? 'visible' : 'hidden' }}
          onClick={() => navigate(-1)}
        >‹</button>

        <img
          ref={imgRef}
          className="lightbox-img"
          src={isVid ? undefined : url}
          draggable={false}
          style={{ display: isVid ? 'none' : 'block' }}
        />
        <video
          ref={videoRef}
          className="lightbox-video"
          src={isVid ? url : undefined}
          controls
          playsInline
          style={{ display: isVid ? 'block' : 'none' }}
        />

        <button
          className="lightbox-nav lightbox-next"
          style={{ visibility: fileIndex < totalFiles - 1 ? 'visible' : 'hidden' }}
          onClick={() => navigate(1)}
        >›</button>
      </div>
    </div>
  );
}
