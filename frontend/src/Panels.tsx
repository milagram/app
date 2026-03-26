/**
 * Panels.tsx — Auxiliary panels
 *
 * Contains:
 * - ProfilePage — user profile settings
 * - AdminPanel — statistics, users, API keys, backup, import
 * - DebugPanel — file tree (Obsidian Ready)
 * - CreateChannelPanel — create/edit channel
 * - MembersPanel — channel members + invitations
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './store';
import { api, login, getToken } from './api';
import { getCurrentUser } from './api';
import { EmojiPicker } from './Composer';
import { generateMarkdownContent, formatBytes, copyToClipboard } from './utils';

/* ============================================================
 * ProfilePage — user settings
 * ============================================================ */

export function ProfilePage() {
  const { t } = useTranslation();
  const { currentUser, setCurrentUser, setAuth } = useAppStore();
  const [displayName, setDisplayName] = useState(currentUser?.display_name || '');
  const [username, setUsername] = useState(currentUser?.username || '');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  if (!currentUser) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword && newPassword !== confirmPassword) {
      setStatus(t('panel.passwordMismatch'));
      return;
    }
    if (newPassword && newPassword.length < 4) {
      setStatus(t('panel.passwordTooShort'));
      return;
    }

    setSaving(true);
    setStatus('');
    try {
      const body: any = {};
      if (displayName !== (currentUser.display_name || '')) body.display_name = displayName;
      if (username !== currentUser.username) body.username = username;
      if (newPassword) body.password = newPassword;

      if (Object.keys(body).length === 0) {
        setStatus(t('panel.noChanges'));
        setSaving(false);
        return;
      }

      const res = await fetch('/api/me', {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${getToken()}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || t('panel.saveError'));
      }

      const data = await res.json();
      setCurrentUser(data.user);

      // If username changed, update token
      if (data.token) {
        setAuth(data.token, data.user);
      }

      setNewPassword('');
      setConfirmPassword('');
      setStatus(t('panel.saved'));
      setTimeout(() => setStatus(''), 2000);
    } catch (err: any) {
      setStatus(t('panel.errorPrefix') + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="timeline-container" style={{ padding: 0 }}>
        <div className="admin-content">
          <h2 className="admin-title">{t('panel.profile')}</h2>

          <div className="admin-section">
            <div className="admin-stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="admin-stat">
                <span className="admin-stat-value">@{currentUser.username}</span>
                <span className="admin-stat-label">{t('panel.login')}</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value">{currentUser.is_admin ? t('panel.admin') : t('panel.user')}</span>
                <span className="admin-stat-label">{t('panel.role')}</span>
              </div>
            </div>
          </div>

          <div className="admin-section">
            <h3 className="admin-section-title">{t('panel.editProfile')}</h3>
            <form className="admin-add-form" onSubmit={handleSave}>
              <input
                type="text"
                className="admin-input"
                placeholder={t('panel.displayName')}
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
              />
              <input
                type="text"
                className="admin-input"
                placeholder={t('panel.usernameLatin')}
                value={username}
                onChange={e => setUsername(e.target.value)}
                pattern="[a-zA-Z][a-zA-Z0-9_]{1,31}"
                required
              />
              {status && (
                <div className={status.includes(t('panel.errorPrefix')) || status.includes(t('panel.passwordMismatch')) ? 'admin-error' : 'admin-hint'}>
                  {status}
                </div>
              )}
              <button type="submit" className="admin-submit-btn" disabled={saving}>
                {saving ? t('panel.saving') : t('panel.save')}
              </button>
            </form>
          </div>

          <div className="admin-section">
            <h3 className="admin-section-title">{t('panel.changePassword')}</h3>
            <form className="admin-add-form" onSubmit={handleSave}>
              <input
                type="password"
                className="admin-input"
                placeholder={t('panel.newPassword')}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                minLength={4}
              />
              <input
                type="password"
                className="admin-input"
                placeholder={t('panel.confirmPassword')}
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
              />
              <button type="submit" className="admin-submit-btn" disabled={saving || !newPassword}>
                {t('panel.changePassword')}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * AdminPanel
 * ============================================================ */

export function AdminPanel() {
  const { t } = useTranslation();
  const [users, setUsers] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [openReg, setOpenReg] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Add user form
  const [newUsername, setNewUsername] = useState('');
  const [newDisplay, setNewDisplay] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [addError, setAddError] = useState('');

  // Telegram import
  const [importChannel, setImportChannel] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStatus, setImportStatus] = useState('');
  const [importing, setImporting] = useState(false);

  // API Keys
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [newKeyName, setNewKeyName] = useState('');
  const [createdKey, setCreatedKey] = useState('');

  // Backup
  const [backupMaxSize, setBackupMaxSize] = useState(200);
  const [backupStatus, setBackupStatus] = useState('');
  const [backupFiles, setBackupFiles] = useState<{ name: string; size: number }[]>([]);
  const [backingUp, setBackingUp] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      // Multi-user: load users, stats, settings
      if (api.listUsers) {
        try {
          const [u, s, settings] = await Promise.all([
            api.listUsers(),
            api.getAdminStats!(),
            api.getAdminSettings!(),
          ]);
          setUsers(u);
          setStats(s);
          setOpenReg(settings.open_registration !== false);
        } catch {}
      }
      // API keys — works in both modes
      try {
        const keysRes = await fetch('/api/admin/api-keys', { headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
        if (keysRes.ok) setApiKeys(await keysRes.json());
      } catch {}
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleToggleReg = async (checked: boolean) => {
    setOpenReg(checked);
    try {
      await api.updateAdminSettings!({ open_registration: checked });
    } catch (err: any) {
      alert(t('panel.errorPrefix') + err.message);
      setOpenReg(!checked);
    }
  };

  const handleDeleteUser = async (userId: number, name: string) => {
    if (!confirm(t('panel.deleteUserConfirm', { name }))) return;
    try {
      await api.adminDeleteUser!(String(userId));
      setUsers(prev => prev.filter(u => u.id !== userId));
    } catch (err: any) {
      alert(t('panel.errorPrefix') + err.message);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddError('');
    if (!newUsername || !newPassword) return;
    try {
      await api.adminCreateUser!({
        username: newUsername,
        password: newPassword,
        display_name: newDisplay || undefined,
      });
      setNewUsername('');
      setNewDisplay('');
      setNewPassword('');
      await load();
    } catch (err: any) {
      setAddError(err.message);
    }
  };

  if (loading) {
    return (
      <div className="chat-container">
        <div className="timeline-container" style={{ padding: 20 }}>
          <div className="loading-dots"><span></span><span></span><span></span></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="chat-container">
        <div className="timeline-container" style={{ padding: 20 }}>
          <div className="admin-content">
            <div className="admin-error">{t('panel.loadError')}: {error}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-container">
      <div className="timeline-container" style={{ padding: 0 }}>
        <div className="admin-content">
          <h2 className="admin-title">{t('panel.adminPanel')}</h2>

          {stats && (
            <div className="admin-stats">
              <div className="admin-stat">
                <span className="admin-stat-value">{stats.users}</span>
                <span className="admin-stat-label">{t('panel.usersCount')}</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value">{stats.channels}</span>
                <span className="admin-stat-label">{t('panel.channelsCount')}</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value">{stats.posts}</span>
                <span className="admin-stat-label">{t('panel.postsCount')}</span>
              </div>
              <div className="admin-stat">
                <span className="admin-stat-value">{formatBytes(stats.storage_bytes)}</span>
                <span className="admin-stat-label">{t('panel.storage')}</span>
              </div>
            </div>
          )}

          <div className="admin-section">
            <h3 className="admin-section-title">{t('panel.settings')}</h3>
            <label className="admin-toggle">
              <input
                type="checkbox"
                checked={openReg}
                onChange={e => handleToggleReg(e.target.checked)}
              />
              <span>{t('panel.openRegistration')}</span>
            </label>
            <div className="admin-hint">{t('panel.openRegistrationHint')}</div>
          </div>

          <div className="admin-section">
            <h3 className="admin-section-title">{t('panel.users')}</h3>
            <div className="admin-users-list">
              {users.map(u => (
                <div key={u.id} className="admin-user-row">
                  <div className="admin-user-info">
                    <span className="admin-user-name">{u.display_name || u.username}</span>
                    <span className="admin-user-meta">@{u.username}{u.is_admin ? ' · admin' : ''}</span>
                  </div>
                  {!u.is_admin && (
                    <button
                      className="admin-user-delete"
                      onClick={() => handleDeleteUser(u.id, u.display_name || u.username)}
                      title={t('panel.delete')}
                    >×</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="admin-section">
            <h3 className="admin-section-title">{t('panel.telegramImport')}</h3>
            <div className="admin-hint" style={{ marginBottom: 8 }}>
              {t('panel.telegramStep1')}<br/>
              {t('panel.telegramStep2')}<br/>
              {t('panel.telegramStep3')}<br/>
              {t('panel.telegramStep4')}
            </div>
            <form className="admin-add-form" onSubmit={async (e) => {
              e.preventDefault();
              if (!importFile || !importChannel) return;
              setImporting(true);
              setImportStatus(t('panel.importing'));
              try {
                const fd = new FormData();
                fd.append('channel', importChannel);
                fd.append('file', importFile);
                const res = await fetch('/api/import/telegram', {
                  method: 'POST',
                  headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                  body: fd,
                });
                if (!res.ok) {
                  const err = await res.json().catch(() => ({ detail: res.statusText }));
                  throw new Error(err.detail || t('panel.importError'));
                }
                setImportStatus(t('panel.importComplete'));
                setImportFile(null);
                setImportChannel('');
              } catch (err: any) {
                setImportStatus(t('panel.errorPrefix') + err.message);
              } finally {
                setImporting(false);
              }
            }}>
              <input
                type="text"
                className="admin-input"
                placeholder={t('panel.channelInput')}
                required
                value={importChannel}
                onChange={e => setImportChannel(e.target.value)}
                disabled={importing}
              />
              <input
                type="file"
                accept=".zip"
                className="admin-input"
                onChange={e => setImportFile(e.target.files?.[0] || null)}
                disabled={importing}
              />
              {importStatus && <div className={importStatus.includes(t('panel.errorPrefix')) ? 'admin-error' : 'admin-hint'}>{importStatus}</div>}
              <button type="submit" className="admin-submit-btn" disabled={importing || !importFile || !importChannel}>
                {importing ? t('panel.importing') : t('panel.import')}
              </button>
            </form>
          </div>

          <div className="admin-section">
            <h3 className="admin-section-title">{t('panel.apiKeys')}</h3>
            <div className="admin-hint" style={{ marginBottom: 8 }}>
              {t('panel.apiKeysHint')}
              <br/>{t('panel.apiKeyHeader')}
            </div>
            {apiKeys.length > 0 && (
              <div className="admin-users-list" style={{ marginBottom: 8 }}>
                {apiKeys.map(k => (
                  <div key={k.key} className="admin-user-row">
                    <div className="admin-user-info">
                      <span className="admin-user-name">{k.name}</span>
                      <span className="admin-user-meta" style={{ fontFamily: 'monospace' }}>{k.key}</span>
                    </div>
                    <button
                      className="admin-user-delete"
                      onClick={async () => {
                        const prefix = k.key.substring(0, 8);
                        await fetch(`/api/admin/api-keys/${prefix}`, {
                          method: 'DELETE',
                          headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                        });
                        load();
                      }}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
            <form className="admin-add-form" onSubmit={async (e) => {
              e.preventDefault();
              if (!newKeyName.trim()) return;
              try {
                const res = await fetch('/api/admin/api-keys', {
                  method: 'POST',
                  headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({ name: newKeyName }),
                });
                if (!res.ok) throw new Error(t('panel.createKeyError'));
                const data = await res.json();
                setCreatedKey(data.key);
                setNewKeyName('');
                load();
              } catch {}
            }}>
              <input
                type="text"
                className="admin-input"
                placeholder={t('panel.keyName')}
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                required
              />
              <button type="submit" className="admin-submit-btn">{t('panel.createKey')}</button>
            </form>
            {createdKey && (
              <div className="admin-hint" style={{ marginTop: 8, padding: '8px 12px', background: 'var(--accent-soft)', borderRadius: 8, wordBreak: 'break-all' }}>
                <strong>{t('panel.copyKeyMsg')}</strong><br/>
                <code style={{ fontSize: 13 }}>{createdKey}</code>
                <button
                  style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontSize: 12 }}
                  onClick={() => { navigator.clipboard.writeText(createdKey); }}
                >{t('panel.copyBtn')}</button>
              </div>
            )}
          </div>

          <div className="admin-section">
            <h3 className="admin-section-title">{t('panel.backup')}</h3>
            <div className="admin-hint" style={{ marginBottom: 8 }}>
              {t('panel.backupStep1')}<br/>
              {t('panel.backupStep2')}
            </div>
            <div className="admin-add-form">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{t('panel.backupMaxSize')}:</label>
                <select
                  className="admin-input"
                  style={{ width: 'auto' }}
                  value={backupMaxSize}
                  onChange={e => setBackupMaxSize(parseInt(e.target.value))}
                  disabled={backingUp}
                >
                  <option value={50}>50 MB</option>
                  <option value={100}>100 MB</option>
                  <option value={200}>200 MB</option>
                  <option value={500}>500 MB</option>
                  <option value={1000}>1 GB</option>
                </select>
              </div>
              <button
                type="button"
                className="admin-submit-btn"
                disabled={backingUp}
                onClick={async () => {
                  setBackingUp(true);
                  setBackupStatus(t('panel.archiving'));
                  setBackupFiles([]);
                  try {
                    const fd = new FormData();
                    fd.append('max_size_mb', String(backupMaxSize));
                    const res = await fetch('/api/admin/backup', {
                      method: 'POST',
                      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                      body: fd,
                    });
                    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || res.statusText);
                    const data = await res.json();
                    setBackupStatus(t('panel.archiveComplete', { files: data.files, parts: data.parts.length }));
                    // Load file list
                    const listRes = await fetch('/api/admin/backup/list', {
                      headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    });
                    if (listRes.ok) setBackupFiles(await listRes.json());
                  } catch (err: any) {
                    setBackupStatus(t('panel.errorPrefix') + err.message);
                  } finally {
                    setBackingUp(false);
                  }
                }}
              >
                {backingUp ? t('panel.archiving') : t('panel.createArchive')}
              </button>
              {backupStatus && <div className="admin-hint">{backupStatus}</div>}
              {backupFiles.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
                  {backupFiles.map(f => (
                    <a
                      key={f.name}
                      href={`/api/admin/backup/download/${f.name}?token=${localStorage.getItem('token')}`}
                      download={f.name}
                      className="admin-backup-link"
                    >
                      ↓ {f.name} ({(f.size / 1024 / 1024).toFixed(1)} MB)
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="admin-section">
            <h3 className="admin-section-title">{t('panel.addUser')}</h3>
            <form className="admin-add-form" onSubmit={handleAddUser}>
              <input
                type="text"
                className="admin-input"
                placeholder={t('panel.usernameLatin')}
                required
                value={newUsername}
                onChange={e => setNewUsername(e.target.value)}
              />
              <input
                type="text"
                className="admin-input"
                placeholder={t('panel.displayName')}
                value={newDisplay}
                onChange={e => setNewDisplay(e.target.value)}
              />
              <input
                type="password"
                className="admin-input"
                placeholder={t('panel.passwordMinInput')}
                required
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
              />
              {addError && <div className="admin-error">{addError}</div>}
              <button type="submit" className="admin-submit-btn">{t('panel.create')}</button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * DebugPanel
 * ============================================================ */

export function DebugPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { channels, currentChannel, posts } = useAppStore();
  const [viewerFile, setViewerFile] = useState<{ path: string; content: string } | null>(null);

  const sortedPosts = useMemo(
    () => [...posts].sort((a, b) => a.basename.localeCompare(b.basename)),
    [posts],
  );

  const handleFileClick = (postIndex: number) => {
    const post = sortedPosts[postIndex];
    if (!post) return;
    setViewerFile({
      path: `/${currentChannel}/${post.basename}/${post.basename}.md`,
      content: generateMarkdownContent(post),
    });
  };

  return (
    <div id="debug-panel" className="active" style={{ display: 'flex' }}>
      <div className="debug-header">
        <span>Filesystem (Obsidian Ready)</span>
        <button className="close-debug" onClick={onClose}>× {t('panel.closeDebug')}</button>
      </div>
      <div className="debug-workspace">
        <div className="debug-tree-pane">
          {/* Tree root */}
          <div style={{ color: '#4ade80' }}>/data/posts/</div>

          {channels.map((ch, chIdx) => {
            const isLastCh = chIdx === channels.length - 1;
            const chBranch = isLastCh ? '└── ' : '├── ';
            const chPipe = isLastCh ? '\u00A0\u00A0\u00A0\u00A0' : '│\u00A0\u00A0\u00A0';
            const isCurrent = ch.name === currentChannel;
            const chLabel = ch.display_name
              ? `${ch.name}/ (${ch.display_name})`
              : `${ch.name}/`;

            return (
              <div key={ch.name}>
                <div>
                  <span className="tree-branch">{chBranch}</span>
                  <span className={`tree-folder${isCurrent ? ' current' : ''}`}>📁 {chLabel}</span>
                </div>

                {isCurrent && sortedPosts.map((post, index) => {
                  const isLast = index === sortedPosts.length - 1;
                  const branch = isLast ? '└── ' : '├── ';
                  const pipe = isLast ? '\u00A0\u00A0\u00A0\u00A0' : '│\u00A0\u00A0\u00A0';

                  const hasContent = !!(post.text || post.title);
                  let fileCount = (hasContent ? 1 : 0) + post.files.length;
                  let cur = 0;

                  return (
                    <div key={post.basename}>
                      <div>
                        <span className="tree-branch">{chPipe}{branch}</span>
                        <span className="tree-folder">📁 {post.basename}/</span>
                      </div>

                      {hasContent && (() => {
                        cur++;
                        const fb = cur === fileCount ? '└── ' : '├── ';
                        return (
                          <div>
                            <span className="tree-branch">{chPipe}{pipe}{fb}</span>
                            <span
                              className="tree-file clickable"
                              onClick={() => handleFileClick(index)}
                              style={{ cursor: 'pointer' }}
                            >📄 {post.basename}.md</span>
                          </div>
                        );
                      })()}

                      {post.files.map((file, fIdx) => {
                        cur++;
                        const fb = (cur + (hasContent ? 1 : 0)) === fileCount ? '└── ' : '├── ';
                        return (
                          <div key={file.name}>
                            <span className="tree-branch">{chPipe}{pipe}{fb}</span>
                            <span className="tree-file">🖼️ {file.name}</span>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        <div className={`debug-viewer-pane${viewerFile ? ' active' : ''}`}>
          <div className="viewer-header">{viewerFile?.path || '/path/to/file'}</div>
          <div className="viewer-content">
            <pre>{viewerFile?.content}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ============================================================
 * CreateChannelPanel
 * ============================================================ */

export function CreateChannelPanel({ editingChannel, onClose }: {
  editingChannel: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { channels, setChannels } = useAppStore();
  const existing = editingChannel ? channels.find(c => c.name === editingChannel) : null;

  const [name, setName] = useState(existing?.name || '');
  const [displayName, setDisplayName] = useState(existing?.display_name || '');
  const [emoji, setEmoji] = useState(existing?.emoji || '');
  const [description, setDescription] = useState(existing?.description || '');
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      if (editingChannel) {
        await api.updateChannel(editingChannel, { display_name: displayName, emoji, description });
      } else {
        await api.createChannel({ name, display_name: displayName, emoji, description });
      }
      const updated = await api.getChannels();
      setChannels(updated);
      onClose();
    } catch (err: any) {
      setError(err.message);
    }
  };

  return (
    <div className="panel-overlay" style={{ display: 'flex' }}>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="panel-sheet">
        <div className="panel-header">
          <span className="panel-title">{editingChannel ? t('panel.editChannel') : t('panel.newChannel')}</span>
          <button type="button" className="panel-close" onClick={onClose}>×</button>
        </div>
        <form className="panel-body" onSubmit={handleSubmit}>
          <div className="login-subtitle">{t('panel.channelAddressHint')}</div>
          <input
            type="text"
            className="login-input"
            placeholder="channel_address"
            pattern="[a-z][a-z0-9_]{2,31}"
            required
            disabled={!!editingChannel}
            value={name}
            onChange={e => setName(e.target.value)}
          />
          <input
            type="text"
            className="login-input"
            placeholder={t('panel.channelDisplayName')}
            maxLength={100}
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
          />
          <EmojiPicker selected={emoji} onSelect={setEmoji} />
          <input
            type="text"
            className="login-input"
            placeholder={t('panel.channelDescription')}
            maxLength={200}
            value={description}
            onChange={e => setDescription(e.target.value)}
          />
          {error && <div className="login-error">{error}</div>}
          <div className="channel-form-buttons">
            <button type="submit" className="login-btn">
              {editingChannel ? t('panel.save') : t('panel.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ============================================================
 * MembersPanel
 * ============================================================ */

export function MembersPanel({ channel, onClose }: { channel: string; onClose: () => void }) {
  const { t } = useTranslation();
  const { channels } = useAppStore();
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [inviteRole, setInviteRole] = useState('viewer');
  const [inviteLink, setInviteLink] = useState('');
  const [isOwner, setIsOwner] = useState(false);

  const ch = channels.find(c => c.name === channel);
  const title = ch?.display_name || channel;

  const loadMembers = async () => {
    setLoading(true);
    try {
      const m = await api.getChannelMembers!(channel);
      setMembers(m);
      const currentUser = getCurrentUser();
      const owner = !!(currentUser && (
        currentUser.is_admin ||
        m.some((mem: any) => mem.user_id === currentUser.id && mem.role === 'owner')
      ));
      setIsOwner(owner);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadMembers(); }, [channel]);

  const handleRemoveMember = async (userId: number) => {
    if (!confirm(t('panel.removeConfirm'))) return;
    try {
      await api.removeChannelMember!(channel, String(userId));
      await loadMembers();
    } catch (err: any) {
      alert(t('panel.errorPrefix') + err.message);
    }
  };

  const handleCreateInvite = async () => {
    try {
      const invite = await api.createInvite!(channel, {
        role: inviteRole,
        max_uses: 10,
        expires_in_days: 7,
      });
      const url = `${window.location.origin}/invite/${invite.token}`;
      setInviteLink(url);
    } catch (err: any) {
      setInviteLink(t('panel.errorPrefix') + err.message);
    }
  };

  const handleCopyLink = async () => {
    await copyToClipboard(inviteLink);
    const saved = inviteLink;
    setInviteLink(t('panel.copiedLink'));
    setTimeout(() => setInviteLink(saved), 1500);
  };

  const roleLabels: Record<string, string> = {
    owner: t('panel.ownerRole'),
    editor: t('panel.editorRole'),
    viewer: t('panel.viewerRole'),
  };

  return (
    <div className="panel-overlay" style={{ display: 'flex' }}>
      <div className="panel-backdrop" onClick={onClose} />
      <div className="panel-sheet">
        <div className="panel-header">
          <span className="panel-title">{t('panel.membersTitle')}: {title}</span>
          <button type="button" className="panel-close" onClick={onClose}>×</button>
        </div>
        <div className="panel-body">
          {loading ? (
            <div className="loading-dots"><span></span><span></span><span></span></div>
          ) : error ? (
            <div className="login-error">{error}</div>
          ) : (
            <>
              <div className="admin-users-list">
                {members.map(m => (
                  <div key={m.user_id} className="member-row">
                    <div className="member-info">
                      <span className="member-name">{m.display_name || m.username}</span>
                      <span className="member-role">{roleLabels[m.role] || m.role}</span>
                    </div>
                    {isOwner && m.role !== 'owner' && (
                      <button
                        className="member-remove"
                        onClick={() => handleRemoveMember(m.user_id)}
                        title={t('panel.remove')}
                      >×</button>
                    )}
                  </div>
                ))}
              </div>

              {isOwner && (
                <div className="admin-section" style={{ marginTop: 20 }}>
                  <h3 className="admin-section-title">{t('panel.invite')}</h3>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                    <select
                      className="admin-input"
                      style={{ flex: 1 }}
                      value={inviteRole}
                      onChange={e => setInviteRole(e.target.value)}
                    >
                      <option value="viewer">{t('panel.viewerRole')}</option>
                      <option value="editor">{t('panel.editorRole')}</option>
                    </select>
                    <button
                      type="button"
                      className="admin-submit-btn"
                      onClick={handleCreateInvite}
                    >
                      {t('panel.createLink')}
                    </button>
                  </div>
                  {inviteLink && (
                    <div
                      className="invite-link-result show"
                      onClick={handleCopyLink}
                      title={t('panel.clickToCopy')}
                      style={{ cursor: 'pointer', wordBreak: 'break-all' }}
                    >
                      {inviteLink}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
