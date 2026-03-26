/**
 * Auth.tsx — Authentication screens
 *
 * Three components in one file:
 * - LoginScreen — login (username + password)
 * - RegisterScreen — registration
 * - InviteScreen — accepting a channel invitation
 */

import { useState, useRef, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './store';
import { login, register, getInviteInfo, acceptInvite, getToken } from './api';

/* ============================================================
 * LoginScreen
 * ============================================================ */

export function LoginScreen({ onSuccess, onShowRegister }: {
  onSuccess: () => Promise<void>;
  onShowRegister: () => void;
}) {
  const { t } = useTranslation();
  const { openRegistration } = useAppStore();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => usernameRef.current?.focus(), 100);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    if (!username) {
      setError(t('auth.usernameRequired'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      await login(password, username);
      await onSuccess();
    } catch (err: any) {
      setError(err.message.includes('Wrong') ? t('auth.invalidCredentials') : err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen" style={{ display: 'flex' }}>
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">Milagram</div>
        <div className="login-subtitle">{t('auth.loginSubtitle')}</div>

        <input
          ref={usernameRef}
          type="text"
          className="login-input"
          placeholder={t('auth.username')}
          autoComplete="username"
          value={username}
          onChange={e => setUsername(e.target.value)}
        />

        <input
          type="password"
          className="login-input"
          placeholder={t('auth.password')}
          autoComplete="current-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        {error && <div className="login-error">{error}</div>}

        <button type="submit" className="login-btn" disabled={loading}>
          {loading ? '...' : t('auth.login')}
        </button>

        {openRegistration && (
          <div className="login-link">
            {t('auth.noAccount')}{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); onShowRegister(); }}>
              {t('auth.register')}
            </a>
          </div>
        )}
      </form>
    </div>
  );
}

/* ============================================================
 * RegisterScreen
 * ============================================================ */

export function RegisterScreen({ onSuccess, onShowLogin }: {
  onSuccess: () => Promise<void>;
  onShowLogin: () => void;
}) {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => usernameRef.current?.focus(), 100);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError(t('auth.allFieldsRequired'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      await register(username, password, displayName);
      await onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-screen" style={{ display: 'flex' }}>
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">Milagram</div>
        <div className="login-subtitle">{t('auth.registerSubtitle')}</div>

        <input
          ref={usernameRef}
          type="text"
          className="login-input"
          placeholder={t('auth.usernameLatin')}
          autoComplete="username"
          required
          value={username}
          onChange={e => setUsername(e.target.value)}
        />
        <input
          type="text"
          className="login-input"
          placeholder={t('auth.displayName')}
          autoComplete="name"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
        />
        <input
          type="password"
          className="login-input"
          placeholder={t('auth.passwordMin')}
          autoComplete="new-password"
          required
          value={password}
          onChange={e => setPassword(e.target.value)}
        />

        {error && <div className="login-error">{error}</div>}

        <button type="submit" className="login-btn" disabled={loading}>
          {loading ? '...' : t('auth.createAccount')}
        </button>

        <div className="login-link">
          {t('auth.hasAccount')}{' '}
          <a href="#" onClick={(e) => { e.preventDefault(); onShowLogin(); }}>
            {t('auth.login')}
          </a>
        </div>
      </form>
    </div>
  );
}

/* ============================================================
 * InviteScreen
 * ============================================================ */

export function InviteScreen({ onSuccess }: { onSuccess: () => Promise<void> }) {
  const { t } = useTranslation();
  const { token: inviteToken } = useParams<{ token: string }>();
  const [info, setInfo] = useState<any>(null);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState('');
  const isLoggedIn = !!getToken();

  useEffect(() => {
    if (!inviteToken) return;
    getInviteInfo(inviteToken)
      .then(setInfo)
      .catch(err => setFetchError(err.message));
  }, [inviteToken]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteToken) return;

    const credentials: any = {};
    if (!isLoggedIn) {
      if (!username || !password) {
        setError(t('auth.usernamePasswordRequired'));
        return;
      }
      credentials.username = username;
      credentials.password = password;
      credentials.display_name = displayName;
    }

    setLoading(true);
    setError('');
    try {
      await acceptInvite(inviteToken, credentials);
      await onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (fetchError) {
    return (
      <div className="login-screen" style={{ display: 'flex' }}>
        <div className="login-card">
          <div className="login-logo">Milagram</div>
          <div className="login-subtitle">{t('auth.inviteTitle')}</div>
          <div style={{ color: 'var(--accent)' }}>{fetchError}</div>
        </div>
      </div>
    );
  }

  if (!info) {
    return (
      <div className="login-screen" style={{ display: 'flex' }}>
        <div className="loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }

  const roleLabel = info.role === 'editor' ? t('auth.editorRole') : t('auth.viewerRole');
  const channelLabel = info.channelEmoji
    ? `${info.channelEmoji} ${info.channelDisplayName}`
    : info.channelDisplayName;

  return (
    <div className="login-screen" style={{ display: 'flex' }}>
      <form className="login-card" onSubmit={handleSubmit}>
        <div className="login-logo">Milagram</div>
        <div className="login-subtitle">{t('auth.inviteTitle')}</div>

        <div className="invite-info">
          <div className="invite-channel-name">{channelLabel}</div>
          <div className="invite-role-label">{t('auth.roleLabel')} {roleLabel}</div>
        </div>

        {!isLoggedIn && (
          <>
            <input
              type="text"
              className="login-input"
              placeholder={t('auth.username')}
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
            />
            <input
              type="password"
              className="login-input"
              placeholder={t('auth.password')}
              autoComplete="new-password"
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            <input
              type="text"
              className="login-input"
              placeholder={t('auth.displayNameOptional')}
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
            />
          </>
        )}

        {error && <div className="login-error">{error}</div>}

        <button type="submit" className="login-btn" disabled={loading}>
          {loading ? '...' : isLoggedIn ? t('auth.join') : t('auth.acceptInvite')}
        </button>
      </form>
    </div>
  );
}
