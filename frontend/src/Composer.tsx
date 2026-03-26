/**
 * Composer.tsx — Post input form
 *
 * Architecture:
 * - ComposerForm — presentational component (title, text, files, date → onSubmit(ComposerOutput))
 * - Composer     — shell: connects ComposerForm to API, upload, store
 * - UploadProgress — progress bar
 * - FilePreview    — file previews
 * - EmojiPicker    — emoji grid (also used in Panels.tsx)
 *
 * Pure logic (normalizeText, buildPostInput, validatePost) is in composer-logic.ts
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import { useAppStore } from './store';
import { api } from './api';
import type { MediaFile, PostInput, UploadProgressCallback } from './api';
import type { ComposerOutput } from './composer-logic';
import { normalizePastedText, buildPostInput, validatePost, insertTextAt } from './composer-logic';
import { isVideo, formatBytes } from './utils';
import flatpickr from 'flatpickr';
import 'flatpickr/dist/flatpickr.min.css';
import 'flatpickr/dist/l10n/ru';



/* ============================================================
 * Upload state types
 * ============================================================ */

interface UploadState {
  active: boolean;
  stage: 'preparing' | 'uploading' | 'processing' | 'done' | 'error';
  percent: number;
  bytesLoaded: number;
  bytesTotal: number;
  error: string;
  retryCount: number;
}

const INITIAL_UPLOAD: UploadState = {
  active: false,
  stage: 'preparing',
  percent: 0,
  bytesLoaded: 0,
  bytesTotal: 0,
  error: '',
  retryCount: 0,
};

const MAX_RETRIES = 3;

/* ============================================================
 * ComposerForm — presentational component
 *
 * Props in:  initialData (for editing), disabled
 * Props out: onSubmit(ComposerOutput, files: MediaFile[])
 *
 * Does NOT know about API, upload progress, or store
 * All data transformation goes through composer-logic.ts
 * ============================================================ */

export interface ComposerFormProps {
  /** Pre-fill form for editing */
  initialData?: {
    title: string;
    text: string;
    files: MediaFile[];
    editBasename: string;
  } | null;
  /** Disable all inputs (during upload) */
  disabled?: boolean;
  /** Called with processed output when user submits */
  onSubmit: (output: ComposerOutput, files: MediaFile[]) => void;
  /** Called when user cancels editing */
  onCancel?: () => void;
  /** Current channel for media URLs */
  channel: string | null;
}

export function ComposerForm({ initialData, disabled, onSubmit, onCancel, channel }: ComposerFormProps) {
  const { t } = useTranslation();
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [pendingFiles, setPendingFiles] = useState<MediaFile[]>([]);
  const [customDate, setCustomDate] = useState('');
  const [descOpen, setDescOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [templates, setTemplatesState] = useState<string[]>([]);

  // Load templates from server when channel changes
  useEffect(() => {
    if (channel) api.getTemplates(channel).then(setTemplatesState).catch(() => {});
  }, [channel]);

  const saveTemplates = (t: string[]) => {
    setTemplatesState(t);
    if (channel) api.saveTemplates(channel, t).catch(() => {});
  };

  const titleRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const isEditing = initialData != null;
  const draftKey = `draft_${channel || 'none'}`;

  /* --- Auto-save draft to localStorage --- */
  useEffect(() => {
    if (isEditing) return;
    const timer = setTimeout(() => {
      if (title || text) {
        localStorage.setItem(draftKey, JSON.stringify({ title, text, descOpen }));
      } else {
        localStorage.removeItem(draftKey);
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [title, text, descOpen, draftKey, isEditing]);

  /* --- Restore draft on mount --- */
  useEffect(() => {
    if (isEditing || initialData) return;
    try {
      const saved = localStorage.getItem(draftKey);
      if (saved) {
        const draft = JSON.parse(saved);
        if (draft.title) setTitle(draft.title);
        if (draft.text) { setText(draft.text); setDescOpen(true); }
      }
    } catch {}
  }, [channel]);

  /* --- Fill form when editing --- */
  useEffect(() => {
    if (initialData) {
      setTitle(initialData.title || '');
      setText(initialData.text || '');
      setPendingFiles([...initialData.files]);
      setCustomDate('');
      if (initialData.text) setDescOpen(true);
      setTimeout(() => {
        titleRef.current?.focus();
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
      }, 50);
    }
  }, [initialData]);

  /* --- Reset form + clear draft --- */
  const resetForm = useCallback(() => {
    setTitle('');
    setText('');
    setPendingFiles([]);
    setCustomDate('');
    setDescOpen(false);
    if (textRef.current) textRef.current.style.height = '';
    localStorage.removeItem(draftKey);
  }, [draftKey]);

  /* --- Auto-resize textarea --- */
  const handleTextInput = useCallback((val: string) => {
    setText(val);
    if (textRef.current) {
      textRef.current.style.height = 'auto';
      textRef.current.style.height = Math.min(textRef.current.scrollHeight, 300) + 'px';
    }
  }, []);

  /* --- Normalize pasted text --- */
  const handleTextPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.getData('text/plain');
    if (!pasted) return;

    const normalized = normalizePastedText(pasted);
    if (normalized === null) return; // no changes needed

    e.preventDefault();
    const ta = e.currentTarget;
    const result = insertTextAt(text, normalized, ta.selectionStart, ta.selectionEnd);
    handleTextInput(result.value);
    setTimeout(() => {
      ta.selectionStart = ta.selectionEnd = result.cursorPos;
    }, 0);
  }, [text, handleTextInput]);

  /* --- Submit: build output via pure functions --- */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;

    const input = {
      title,
      text,
      fileNames: pendingFiles.map(f => f.name),
      customDate: customDate || undefined,
      editBasename: initialData?.editBasename,
    };

    const errors = validatePost(input);
    if (errors.length > 0) {
      return;
    }

    const output = buildPostInput(input);
    onSubmit(output, pendingFiles);
    resetForm();
  };

  /* --- Cancel editing --- */
  const handleCancel = () => {
    resetForm();
    onCancel?.();
  };

  /* --- Title keydown: Enter=submit, Shift+Enter=open desc --- */
  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formRef.current?.requestSubmit();
    } else if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (!descOpen) setDescOpen(true);
      setTimeout(() => textRef.current?.focus(), 50);
    }
  };

  /* --- Paste from clipboard (screenshots, copied images) --- */
  const handlePaste = (e: React.ClipboardEvent) => {
    const files = e.clipboardData?.files;
    if (!files || files.length === 0 || disabled) return;
    e.preventDefault();
    const newFiles: MediaFile[] = Array.from(files).map(f => ({
      name: f.name || `paste-${Date.now()}.png`,
      url: URL.createObjectURL(f),
      fileObj: f,
    }));
    setPendingFiles(prev => [...prev, ...newFiles]);
  };

  /* --- File selection --- */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newFiles: MediaFile[] = Array.from(files).map(f => ({
      name: f.name,
      url: URL.createObjectURL(f),
      fileObj: f,
    }));
    setPendingFiles(prev => [...prev, ...newFiles]);
    e.target.value = '';
  };

  /* --- File reorder --- */
  const moveFile = useCallback((from: number, to: number) => {
    setPendingFiles(prev => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  /* --- Remove file --- */
  const removeFile = useCallback((index: number) => {
    setPendingFiles(prev => prev.filter((_, i) => i !== index));
  }, []);

  /* --- Toggle description --- */
  const toggleDesc = () => {
    const next = !descOpen;
    setDescOpen(next);
    if (next) setTimeout(() => textRef.current?.focus(), 50);
  };

  const totalFileSize = pendingFiles.reduce((sum, f) => sum + (f.fileObj?.size || 0), 0);

  return (
    <>
      {/* Edit banner */}
      {isEditing && !disabled && (
        <div className="edit-banner active">
          <span className="edit-subtitle">
            {initialData.title || initialData.text?.substring(0, 40) || t('composer.mediaFiles')}
          </span>
          <button type="button" className="cancel-edit" onClick={handleCancel}>
            {t('composer.cancel')}
          </button>
        </div>
      )}

      <form ref={formRef} className="input-container" onSubmit={handleSubmit} onPaste={handlePaste}>
        {/* Main row: title + send */}
        <div className="input-row">
          <input
            ref={titleRef}
            type="text"
            className="title-input"
            placeholder={t('composer.titlePlaceholder')}
            value={title}
            onChange={e => { if (e.target.value.length <= 80) setTitle(e.target.value); }}
            onKeyDown={handleTitleKeyDown}
            maxLength={80}
            disabled={disabled}
          />

          <button type="submit" className="send-btn" disabled={disabled}>
            {disabled ? '·' : isEditing ? '✓' : '↑'}
          </button>
        </div>

        {/* Expandable description — below title */}
        <div className={`description-area${descOpen ? ' active' : ''}`}>
          <textarea
            ref={textRef}
            className="text-input"
            placeholder={t('composer.textPlaceholder')}
            value={text}
            onChange={e => handleTextInput(e.target.value)}
            onPaste={handleTextPaste}
            disabled={disabled}
          />
        </div>

        {/* File preview */}
        {pendingFiles.length > 0 && (
          <>
            <FilePreview
              files={pendingFiles}
              channel={channel}
              editBasename={initialData?.editBasename}
              onMove={moveFile}
              onRemove={removeFile}
              disabled={disabled}
            />
            {totalFileSize > 0 && !disabled && (
              <div className="upload-file-info">
                {t('composer.filesInfo', { count: pendingFiles.filter(f => f.fileObj).length, size: formatBytes(totalFileSize) })}
              </div>
            )}
          </>
        )}

        {/* Tools row: attach, description toggle, date */}
        <div className="input-tools">
          <button
            type="button"
            className="tool-btn"
            onClick={() => fileRef.current?.click()}
            title={t('composer.attachTooltip')}
            disabled={disabled}
          >
            <span className="tool-icon">⊕</span> {t('composer.file')}
          </button>

          <button
            type="button"
            className={`tool-btn${descOpen ? ' active' : ''}`}
            onClick={toggleDesc}
            title={t('composer.descTooltip')}
            disabled={disabled}
          >
            <span className="tool-icon">Aa</span> {t('composer.text')}
          </button>

          {!isEditing && (
            <DatePicker value={customDate} onChange={setCustomDate} disabled={disabled} />
          )}

          <div className="templates-wrap">
            <button
              type="button"
              className={`tool-btn${templatesOpen ? ' active' : ''}`}
              onPointerDown={(e) => { e.preventDefault(); setTemplatesOpen(!templatesOpen); }}
              disabled={disabled}
            >
              <span className="tool-icon">⚡</span> {t('composer.template')}
            </button>
            {templatesOpen && createPortal(
              <>
                <div className="dropdown-backdrop" onPointerDown={() => setTemplatesOpen(false)} />
                <div className="templates-popup">
                  {templates.length === 0 && (
                    <div className="templates-empty">{t('composer.noTemplates')}</div>
                  )}
                  {templates.map((tpl, i) => (
                    <div key={i} className="template-item" onPointerUp={() => {
                      setTitle(tpl);
                      setTemplatesOpen(false);
                      titleRef.current?.focus();
                    }}>
                      <span className="template-text">{tpl}</span>
                      <button className="template-delete" onPointerDown={(e) => {
                        e.stopPropagation();
                        saveTemplates(templates.filter((_, j) => j !== i));
                      }}>×</button>
                    </div>
                  ))}
                  {title.trim() && (
                    <div className="template-item template-save" onPointerUp={() => {
                      if (title.trim() && !templates.includes(title.trim())) {
                        saveTemplates([...templates, title.trim()]);
                      }
                      setTemplatesOpen(false);
                    }}>
                      {t('composer.saveTemplate', { title: title.length > 30 ? title.substring(0, 30) + '…' : title })}
                    </div>
                  )}
                </div>
              </>,
              document.body
            )}
          </div>

          {title.length > 60 && (
            <span className="char-count">{title.length}/80</span>
          )}
        </div>
      </form>

      {/* Hidden file input */}
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.json,.xml,.zip,.rar,.7z,.mp3,.wav,.py,.js,.ts,.html,.css"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />
    </>
  );
}

/* ============================================================
 * Composer — shell component (API + upload + store)
 *
 * Connects ComposerForm to the outside world
 * ============================================================ */

export function Composer() {
  const { t } = useTranslation();
  const {
    currentChannel, editingPost, editingIndex, posts,
    clearEdit, setPosts,
  } = useAppStore();

  const [upload, setUpload] = useState<UploadState>(INITIAL_UPLOAD);

  // Keep submit data for retry
  const lastSubmitData = useRef<{
    channel: string;
    oldBasename?: string;
    postData: PostInput;
  } | null>(null);

  const isUploading = upload.active && upload.stage !== 'error';

  /* --- Progress callback --- */
  const makeProgressHandler = useCallback((): UploadProgressCallback => {
    return (info) => {
      setUpload(prev => ({
        ...prev,
        active: true,
        stage: info.stage,
        percent: info.percent,
        bytesLoaded: info.bytesLoaded ?? prev.bytesLoaded,
        bytesTotal: info.bytesTotal ?? prev.bytesTotal,
      }));
    };
  }, []);

  /* --- Reset everything --- */
  const resetAll = useCallback(() => {
    setUpload(INITIAL_UPLOAD);
    lastSubmitData.current = null;
    clearEdit();
  }, [clearEdit]);

  /* --- Core submit logic (used for initial submit + retry) --- */
  const doSubmit = useCallback(async (
    submitData: typeof lastSubmitData.current,
    retryCount: number,
  ) => {
    if (!submitData) return;

    setUpload(prev => ({
      ...prev,
      active: true,
      stage: 'preparing',
      percent: 0,
      error: '',
      retryCount,
    }));

    const onProgress = makeProgressHandler();
    const hasFiles = submitData.postData.files.some(f => f.fileObj);

    try {
      if (submitData.oldBasename) {
        await api.updatePost(
          submitData.channel,
          submitData.oldBasename,
          submitData.postData,
          hasFiles ? onProgress : undefined,
        );
      } else {
        await api.createPost(
          submitData.channel,
          submitData.postData,
          hasFiles ? onProgress : undefined,
        );
      }

      setUpload(prev => ({ ...prev, stage: 'done', percent: 100 }));
      const updated = await api.getPosts(submitData.channel, { limit: Math.max(posts.length + 1, 8) });
      setPosts(updated);
      setTimeout(() => resetAll(), 600);
    } catch (err: any) {
      setUpload(prev => ({
        ...prev,
        stage: 'error',
        error: err.message || t('composer.unknownError'),
        retryCount,
      }));
    }
  }, [makeProgressHandler, setPosts, resetAll]);

  /* --- Handle ComposerForm submit --- */
  const handleFormSubmit = useCallback((output: ComposerOutput, files: MediaFile[]) => {
    if (!currentChannel || upload.active) return;

    const isEdit = editingPost !== null && editingIndex !== null;
    const postData: PostInput = {
      title: output.title,
      text: output.text,
      files,
      basename: output.basename,
      customDate: output.customDate,
    };

    lastSubmitData.current = {
      channel: currentChannel,
      oldBasename: isEdit ? editingPost!.basename : undefined,
      postData,
    };

    // Clear edit state immediately so useEffect doesn't re-fill the form
    if (isEdit) clearEdit();

    doSubmit(lastSubmitData.current, 0);
  }, [currentChannel, editingPost, editingIndex, upload.active, doSubmit, clearEdit]);

  /* --- Retry handler --- */
  const handleRetry = useCallback(() => {
    if (!lastSubmitData.current) return;
    const nextRetry = upload.retryCount + 1;
    if (nextRetry > MAX_RETRIES) return;
    doSubmit(lastSubmitData.current, nextRetry);
  }, [upload.retryCount, doSubmit]);

  /* --- Cancel upload (dismiss error) --- */
  const handleCancelUpload = useCallback(() => {
    setUpload(INITIAL_UPLOAD);
    lastSubmitData.current = null;
  }, []);

  // Build initialData for ComposerForm from editing state
  const initialData = editingPost ? {
    title: editingPost.title || '',
    text: editingPost.text || '',
    files: editingPost.files,
    editBasename: editingPost.basename,
  } : null;

  // Adjust position when mobile keyboard opens (visualViewport API)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const handler = () => {
      const offset = window.innerHeight - vv.height - vv.offsetTop;
      document.documentElement.style.setProperty('--keyboard-offset', `${Math.max(0, offset)}px`);
    };
    vv.addEventListener('resize', handler);
    vv.addEventListener('scroll', handler);
    return () => {
      vv.removeEventListener('resize', handler);
      vv.removeEventListener('scroll', handler);
      document.documentElement.style.setProperty('--keyboard-offset', '0px');
    };
  }, []);

  return (
    <div className="input-wrapper">
      {/* Upload progress bar */}
      {upload.active && (
        <UploadProgress
          upload={upload}
          onRetry={handleRetry}
          onCancel={handleCancelUpload}
        />
      )}

      <ComposerForm
        initialData={initialData}
        disabled={isUploading}
        onSubmit={handleFormSubmit}
        onCancel={clearEdit}
        channel={currentChannel}
      />
    </div>
  );
}

/* ============================================================
 * UploadProgress — progress bar with stages and retry
 * ============================================================ */

function UploadProgress({ upload, onRetry, onCancel }: {
  upload: UploadState;
  onRetry: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const stageLabels: Record<string, string> = {
    preparing: t('composer.preparing'),
    uploading: t('composer.uploading'),
    processing: t('composer.processing'),
    done: t('composer.done'),
    error: t('composer.error'),
  };

  const stageIcons: Record<string, string> = {
    preparing: '📦',
    uploading: '📤',
    processing: '⏳',
    done: '✅',
    error: '⚠️',
  };

  const canRetry = upload.stage === 'error' && upload.retryCount < MAX_RETRIES;
  const progressPercent = upload.stage === 'done' ? 100
    : upload.stage === 'processing' ? 100
    : upload.stage === 'preparing' ? 5
    : upload.percent;

  return (
    <div className={`upload-progress${upload.stage === 'error' ? ' upload-error' : ''}`}>
      <div className="upload-progress-header">
        <span className="upload-progress-icon">{stageIcons[upload.stage]}</span>
        <span className="upload-progress-label">{stageLabels[upload.stage]}</span>
        {upload.stage === 'uploading' && upload.bytesTotal > 0 && (
          <span className="upload-progress-bytes">
            {formatBytes(upload.bytesLoaded)} / {formatBytes(upload.bytesTotal)}
          </span>
        )}
        {upload.stage === 'uploading' && (
          <span className="upload-progress-percent">{upload.percent}%</span>
        )}
      </div>

      <div className="upload-progress-bar-track">
        <div
          className={`upload-progress-bar-fill ${upload.stage}`}
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="upload-progress-stages">
        <span className={`upload-stage-dot ${
          ['preparing', 'uploading', 'processing', 'done'].includes(upload.stage) ? 'active' : ''
        } ${upload.stage === 'preparing' ? 'current' : ''}`}>1</span>
        <span className={`upload-stage-dot ${
          ['uploading', 'processing', 'done'].includes(upload.stage) ? 'active' : ''
        } ${upload.stage === 'uploading' ? 'current' : ''}`}>2</span>
        <span className={`upload-stage-dot ${
          ['processing', 'done'].includes(upload.stage) ? 'active' : ''
        } ${upload.stage === 'processing' ? 'current' : ''}`}>3</span>
      </div>

      {upload.stage === 'error' && (
        <div className="upload-error-details">
          <div className="upload-error-message">{upload.error}</div>
          <div className="upload-error-actions">
            {canRetry && (
              <button
                type="button"
                className="upload-retry-btn"
                onClick={onRetry}
              >
                {t('composer.retry', { attempt: upload.retryCount + 1, max: MAX_RETRIES })}
              </button>
            )}
            <button
              type="button"
              className="upload-cancel-btn"
              onClick={onCancel}
            >
              {canRetry ? t('composer.cancelRetry') : t('composer.closeError')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
 * FilePreview
 * ============================================================ */

/* ============================================================
 * DatePicker — flatpickr wrapper
 * ============================================================ */

function DatePicker({ value, onChange, disabled }: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const fpInstance = useRef<any>(null);
  const pendingDate = useRef<string>('');

  const pad = (n: number) => String(n).padStart(2, '0');
  const toIso = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  const isMobile = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Mobile: native datetime-local picker
  const openNativePicker = useCallback(() => {
    if (disabled) return;
    const input = document.createElement('input');
    input.type = 'datetime-local';
    input.style.cssText = 'position:fixed;top:50%;left:50%;opacity:0;width:1px;height:1px';
    if (value) input.value = value;
    document.body.appendChild(input);
    let changed = false;
    input.addEventListener('change', () => {
      changed = true;
      if (input.value) onChange(input.value);
      input.remove();
    });
    input.addEventListener('blur', () => {
      setTimeout(() => { if (!changed && document.body.contains(input)) input.remove(); }, 3000);
    });
    setTimeout(() => { input.focus(); input.click(); }, 100);
  }, [value, onChange, disabled]);

  // Desktop: flatpickr with OK button
  const openFlatpickr = useCallback(() => {
    if (disabled || fpInstance.current) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.style.cssText = 'position:absolute;opacity:0;width:0;height:0;pointer-events:none';
    containerRef.current?.appendChild(input);

    pendingDate.current = value || '';

    const fp = flatpickr(input, {
      enableTime: true,
      time_24hr: true,
      locale: 'ru',
      dateFormat: 'j M, H:i',
      defaultDate: value ? new Date(value) : new Date(),
      appendTo: containerRef.current!,
      static: true,
      closeOnSelect: false,
      onChange: ([date]: Date[], _: string, inst: any) => {
        if (date) pendingDate.current = toIso(date);
        if (inst.hourElement) inst.hourElement.blur();
        if (inst.minuteElement) inst.minuteElement.blur();
      },
      onReady: (_: any, __: string, inst: any) => {
        inst.close = () => {};

        // OK button
        const okBtn = document.createElement('button');
        okBtn.type = 'button';
        okBtn.className = 'flatpickr-ok-btn';
        okBtn.textContent = 'OK';
        okBtn.addEventListener('click', () => {
          if (pendingDate.current) onChange(pendingDate.current);
          cleanup();
        });
        inst.calendarContainer.appendChild(okBtn);

        // Hide native arrows, use custom +/- buttons
        inst.calendarContainer.querySelectorAll('.flatpickr-time .numInputWrapper').forEach((wrapper: HTMLElement) => {
          // Hide default arrows
          wrapper.querySelectorAll<HTMLElement>('.arrowUp, .arrowDown').forEach(a => a.style.display = 'none');
          const inp = wrapper.querySelector('input') as HTMLInputElement;
          if (!inp) return;
          const max = inp.max ? parseInt(inp.max) : (inp.className.includes('flatpickr-hour') ? 23 : 59);

          const btnUp = document.createElement('button');
          btnUp.type = 'button';
          btnUp.className = 'time-step-btn time-step-up';
          btnUp.textContent = '+';
          btnUp.addEventListener('click', (e) => {
            e.preventDefault();
            let v = parseInt(inp.value || '0') + 1;
            if (v > max) v = 0;
            inp.value = String(v).padStart(2, '0');
            inp.dispatchEvent(new Event('input', { bubbles: true }));
          });

          const btnDown = document.createElement('button');
          btnDown.type = 'button';
          btnDown.className = 'time-step-btn time-step-down';
          btnDown.textContent = '−';
          btnDown.addEventListener('click', (e) => {
            e.preventDefault();
            let v = parseInt(inp.value || '0') - 1;
            if (v < 0) v = max;
            inp.value = String(v).padStart(2, '0');
            inp.dispatchEvent(new Event('input', { bubbles: true }));
          });

          wrapper.insertBefore(btnUp, wrapper.firstChild);
          wrapper.appendChild(btnDown);

          // Mouse wheel on time
          inp.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            let v = parseInt(inp.value || '0') + (e.deltaY < 0 ? 1 : -1);
            if (v < 0) v = max;
            if (v > max) v = 0;
            inp.value = String(v).padStart(2, '0');
            inp.dispatchEvent(new Event('input', { bubbles: true }));
          }, { passive: false });
        });

        // Mouse wheel on calendar days → change month
        const daysContainer = inst.calendarContainer.querySelector('.flatpickr-days');
        if (daysContainer) {
          daysContainer.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            if (e.deltaY > 0) inst.changeMonth(1);
            else inst.changeMonth(-1);
          }, { passive: false });
        }

        // Mouse wheel on month dropdown → change month
        const monthSelect = inst.calendarContainer.querySelector('.flatpickr-monthDropdown-months');
        if (monthSelect) {
          monthSelect.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            if (e.deltaY > 0) inst.changeMonth(1);
            else inst.changeMonth(-1);
          }, { passive: false });
        }

        // Mouse wheel on year → change year
        const yearInput = inst.calendarContainer.querySelector('.cur-year');
        if (yearInput) {
          yearInput.addEventListener('wheel', (e: WheelEvent) => {
            e.preventDefault();
            inst.changeYear(inst.currentYear + (e.deltaY < 0 ? 1 : -1));
          }, { passive: false });
        }
      },
    });

    fpInstance.current = fp;
    fp.open();

    // Outside click to close
    const onOutside = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        if (pendingDate.current) onChange(pendingDate.current);
        cleanup();
      }
    };
    setTimeout(() => document.addEventListener('mousedown', onOutside, true), 50);

    const cleanup = () => {
      document.removeEventListener('mousedown', onOutside, true);
      fp.destroy();
      input.remove();
      fpInstance.current = null;
    };
  }, [value, onChange, disabled]);

  return (
    <div className="date-picker-wrap" ref={containerRef}>
      <button
        type="button"
        className={value ? 'date-chosen' : 'tool-btn'}
        disabled={disabled}
        onClick={isMobile ? openNativePicker : openFlatpickr}
      >
        {value ? (
          <>
            {new Date(value).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}{' '}
            {new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </>
        ) : <><span className="tool-icon">◷</span> {t('composer.date')}</>}
      </button>
      {value && (
        <button type="button" className="date-chosen-clear" onClick={() => onChange('')}>×</button>
      )}
    </div>
  );
}

function FilePreview({ files, channel, editBasename, onMove, onRemove, disabled }: {
  files: MediaFile[];
  channel: string | null;
  editBasename?: string;
  onMove: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  const areaRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    idx: number;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);
  const insertRef = useRef<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [insertIdx, setInsertIdx] = useState<number | null>(null);

  const getUrl = (file: MediaFile) => {
    if (file.url) return file.url;
    if (file.fileObj) return URL.createObjectURL(file.fileObj);
    if (channel && editBasename) {
      return api.getMediaUrl(channel, { basename: editBasename } as any, file, true);
    }
    return '';
  };

  /* Calculate which gap the pointer is closest to.
     Returns 0..N where 0 = before first item, N = after last. */
  const calcInsert = useCallback((clientX: number, fromIdx: number): number | null => {
    if (!areaRef.current) return null;
    const items = areaRef.current.querySelectorAll<HTMLElement>('[data-pidx]');
    if (items.length === 0) return null;

    for (let i = 0; i < items.length; i++) {
      const rect = items[i].getBoundingClientRect();
      if (clientX < rect.left + rect.width / 2) {
        return (i === fromIdx || i === fromIdx + 1) ? null : i;
      }
    }
    const last = items.length;
    return (last === fromIdx + 1) ? null : last;
  }, []);

  /* --- Pointer down on an item --- */
  const handlePointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    if (disabled || e.button !== 0) return;
    // Don't intercept clicks on buttons (remove, move arrows)
    if ((e.target as HTMLElement).closest('button')) return;

    // Prevent browser's native image drag
    e.preventDefault();

    dragRef.current = { idx, startX: e.clientX, startY: e.clientY, active: false };
  }, [disabled]);

  /* --- Global pointer move / up via effect --- */
  useEffect(() => {
    const handlePtrMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;

      // Activation threshold — 8px to avoid accidental drags
      if (!d.active) {
        if (Math.abs(e.clientX - d.startX) + Math.abs(e.clientY - d.startY) < 8) return;
        d.active = true;
        setDragIdx(d.idx);
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'grabbing';
      }

      const pos = calcInsert(e.clientX, d.idx);
      insertRef.current = pos;
      setInsertIdx(pos);
    };

    const handlePtrUp = () => {
      const d = dragRef.current;
      if (d?.active) {
        const pos = insertRef.current;
        if (pos !== null) {
          const from = d.idx;
          let to = pos > from ? pos - 1 : pos;
          to = Math.max(0, Math.min(to, files.length - 1));
          if (from !== to) onMove(from, to);
        }
      }

      dragRef.current = null;
      insertRef.current = null;
      setDragIdx(null);
      setInsertIdx(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.addEventListener('pointermove', handlePtrMove);
    document.addEventListener('pointerup', handlePtrUp);
    return () => {
      document.removeEventListener('pointermove', handlePtrMove);
      document.removeEventListener('pointerup', handlePtrUp);
    };
    // onMove (prop) intentionally read via closure over files.length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcInsert, files.length, onMove]);

  return (
    <div
      ref={areaRef}
      className={`preview-area${dragIdx !== null ? ' dragging-active' : ''}`}
      style={{ display: 'flex', opacity: disabled ? 0.5 : 1 }}
    >
      {files.map((file, index) => {
        const url = getUrl(file);
        const isDragged = dragIdx === index;
        const showBefore = insertIdx === index;
        const showAfter = insertIdx === files.length && index === files.length - 1;

        return (
          <div
            key={`${file.name}-${index}`}
            data-pidx={index}
            className={
              'preview-item'
              + (isDragged ? ' dragging' : '')
              + (showBefore ? ' drop-left' : '')
              + (showAfter ? ' drop-right' : '')
            }
            onPointerDown={e => handlePointerDown(e, index)}
          >
            <div className="media-order-badge">{index + 1}</div>
            {isVideo(file.name) ? (
              <>
                <video src={url} preload="metadata" muted draggable={false} />
                <div
                  className="video-play-badge"
                  style={{
                    width: 20, height: 20, fontSize: 10,
                    top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
                    position: 'absolute', background: 'rgba(0,0,0,.55)',
                    color: '#fff', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none',
                  }}
                >▶</div>
              </>
            ) : (
              <img src={url} alt={file.name} draggable={false} />
            )}
            {!disabled && (
              <button
                type="button"
                className="remove-media-btn"
                onClick={e => { e.stopPropagation(); onRemove(index); }}
              >×</button>
            )}

            {!disabled && (
              <div className="preview-controls">
                {index > 0 && (
                  <button
                    type="button"
                    className="preview-move-btn"
                    onClick={e => { e.stopPropagation(); onMove(index, index - 1); }}
                  >◂</button>
                )}
                {index < files.length - 1 && (
                  <button
                    type="button"
                    className="preview-move-btn"
                    onClick={e => { e.stopPropagation(); onMove(index, index + 1); }}
                  >▸</button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
 * EmojiPicker
 * ============================================================ */

export function EmojiPicker({ selected, onSelect }: { selected?: string; onSelect: (emoji: string) => void }) {
  const emojis = ['👨‍👩‍👧', '💊', '🏠', '📚', '🎵', '🍕', '✈️', '🎮', '💰', '🏋️', '🐾', '🎂', '📸', '🌿', '🛒', '💡'];
  return (
    <div className="emoji-picker">
      {emojis.map(e => (
        <button
          key={e}
          type="button"
          className={`emoji-picker-btn${selected === e ? ' selected' : ''}`}
          onClick={() => onSelect(e)}
        >
          {e}
        </button>
      ))}
    </div>
  );
}
