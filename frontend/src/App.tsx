/**
 * App.tsx — Main application file
 *
 * Contains:
 * - Router (BrowserRouter + Routes)
 * - Layout (Header + Sidebar + Overlay)
 * - API initialization on startup
 * - Channel navigation
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useParams, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './store';
import { initApi, api, openRegistration, isMockMode, getToken, getCurrentUser, logout as apiLogout } from './api';
import { LoginScreen, RegisterScreen, InviteScreen } from './Auth';
import { ChannelView } from './Feed';
import { Composer } from './Composer';
import { Lightbox } from './Lightbox';
import { AdminPanel, DebugPanel, CreateChannelPanel, MembersPanel, ProfilePage } from './Panels';
import { exportChannelZip } from './utils';

/* ============================================================
 * Layout — Header + Sidebar + main content
 * ============================================================ */

function Header() {
  const { t } = useTranslation();
  const { sidebarOpen, toggleSidebar, currentChannel, channels, showMeta, toggleMeta } = useAppStore();
  const cur = channels.find(c => c.name === currentChannel);
  const headerLabel = cur ? (cur.emoji ? cur.emoji + ' ' : '') + (cur.display_name || cur.name) : '';

  return (
    <div className="header">
      <div className="header-top">
        <div className="header-left">
          <button className="head-btn sidebar-toggle-btn" onClick={toggleSidebar} title={t('app.channels')}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <span className={`header-channel-name${sidebarOpen ? ' hidden-desktop' : ''}`}>{headerLabel}</span>
        </div>
        <div className="header-controls"></div>
      </div>
    </div>
  );
}

/** Placeholder for filters — Feed.tsx will render into this */
function FiltersSlot() {
  return <div className="filters" id="filters-container"></div>;
}

function Sidebar() {
  const { t, i18n } = useTranslation();
  const {
    channels, currentChannel, sidebarOpen, closeSidebar, showMeta, toggleMeta,
    currentUser, authRequired,
  } = useAppStore();
  const navigate = useNavigate();
  const isAdmin = currentUser?.is_admin;
  const showLogout = !!getToken();

  const handleChannelClick = useCallback((name: string) => {
    navigate(`/c/${name}`);
    if (window.innerWidth <= 768) closeSidebar();
  }, [navigate, closeSidebar]);

  const [channelMenuOpen, setChannelMenuOpen] = useState<string | null>(null);
  const [channelMenuPos, setChannelMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [showMembers, setShowMembers] = useState<string | null>(null);
  const [showCreateCh, setShowCreateCh] = useState(false);
  const [editingChannel, setEditingChannel] = useState<string | null>(null);

  return (
    <>
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-header">
          <span className="logo">Milagram</span>
          <button className="sidebar-close-btn" onClick={closeSidebar} title={t('app.close')}>×</button>
        </div>

        <nav className="sidebar-channels">
          {channels.map(ch => {
            const isActive = ch.name === currentChannel;
            return (
              <div
                key={ch.name}
                className={`sidebar-channel${isActive ? ' active' : ''}`}
                onClick={() => handleChannelClick(ch.name)}
              >
                <span className="channel-emoji" style={ch.emoji ? undefined : { fontSize: 16, opacity: 0.4 }}>
                  {ch.emoji || '#'}
                </span>
                <span className="channel-name">{ch.display_name || ch.name}</span>
                {ch.post_count != null && <span className="channel-count">{ch.post_count}</span>}
                {isActive && (
                  <span
                    className="channel-settings-btn"
                    title={t('app.settings')}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (channelMenuOpen === ch.name) {
                        setChannelMenuOpen(null);
                        setChannelMenuPos(null);
                      } else {
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setChannelMenuPos({ top: rect.bottom + 4, left: rect.left });
                        setChannelMenuOpen(ch.name);
                      }
                    }}
                  >⋯</span>
                )}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <button className="sidebar-add-btn" onClick={() => { setEditingChannel(null); setShowCreateCh(true); }}>
            {t('app.newChannel')}
          </button>
          {isAdmin && (
            <div id="sidebar-footer">
              <button
                className="sidebar-add-btn"
                style={{ borderStyle: 'solid', marginTop: 0 }}
                onClick={() => { navigate('/c/_admin'); if (window.innerWidth <= 768) closeSidebar(); }}
              >
                {t('app.adminPanel')}
              </button>
            </div>
          )}
          <div className="sidebar-actions">
            <button
              className={`sidebar-action-btn${showMeta ? ' active' : ''}`}
              onClick={() => { toggleMeta(); if (window.innerWidth <= 768) closeSidebar(); }}
            >
              &lt;/&gt; Src
            </button>
            <button
              className="sidebar-action-btn"
              onClick={() => { setShowDebug(true); closeSidebar(); }}
            >
              {t('app.files')}
            </button>
          </div>
          {currentUser && (
            <button
              className="sidebar-action-btn sidebar-profile-btn"
              onClick={() => { navigate('/c/_profile'); if (window.innerWidth <= 768) closeSidebar(); }}
            >
              👤 {currentUser.display_name || currentUser.username}
            </button>
          )}
          {showLogout && (
            <button className="sidebar-action-btn sidebar-logout-btn" onClick={apiLogout}>
              {t('app.logout')}
            </button>
          )}
          <button
            className="sidebar-action-btn"
            onClick={() => i18n.changeLanguage(i18n.language === 'ru' ? 'en' : 'ru')}
          >
            {i18n.language === 'ru' ? 'EN' : 'RU'}
          </button>
        </div>
      </aside>

      <div
        className={`sidebar-overlay${sidebarOpen ? ' show' : ''}`}
        onClick={closeSidebar}
      />

      {/* Channel dropdown menu */}
      {channelMenuOpen && channelMenuPos && (
        <ChannelMenu
          channelName={channelMenuOpen}
          position={channelMenuPos}
          onClose={() => { setChannelMenuOpen(null); setChannelMenuPos(null); }}
          onShowMembers={(name) => { setShowMembers(name); setChannelMenuOpen(null); setChannelMenuPos(null); }}
          onEdit={(name) => { setEditingChannel(name); setShowCreateCh(true); setChannelMenuOpen(null); setChannelMenuPos(null); }}
        />
      )}

      {/* Panels */}
      {showDebug && <DebugPanel onClose={() => setShowDebug(false)} />}
      {showMembers && <MembersPanel channel={showMembers} onClose={() => setShowMembers(null)} />}
      {showCreateCh && (
        <CreateChannelPanel
          editingChannel={editingChannel}
          onClose={() => { setShowCreateCh(false); setEditingChannel(null); }}
        />
      )}
    </>
  );
}

/** Channel dropdown menu (settings) */
function ChannelMenu({ channelName, position, onClose, onShowMembers, onEdit }: {
  channelName: string;
  position: { top: number; left: number };
  onClose: () => void;
  onShowMembers: (name: string) => void;
  onEdit: (name: string) => void;
}) {
  const { t } = useTranslation();
  const { channels, setChannels } = useAppStore();
  const navigate = useNavigate();
  const isMobile = window.innerWidth <= 768;

  const handleDelete = async () => {
    if (!confirm(t('app.deleteChannelConfirm'))) return;
    try {
      await api.deleteChannel(channelName);
      const updated = await api.getChannels();
      setChannels(updated);
      if (updated.length > 0) navigate(`/c/${updated[0].name}`);
      onClose();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleZip = async () => {
    onClose();
    navigate(`/c/${channelName}`);
    // Load posts and export
    try {
      const posts = await api.getPosts(channelName);
      await exportChannelZip(channelName, posts);
    } catch (e: any) {
      alert(t('app.exportError') + e.message);
    }
  };

  return (
    <>
      <div className="dropdown-overlay show" onClick={onClose} />
      <div
        className={`dropdown-menu show${isMobile ? ' bottom-sheet' : ''}`}
        style={isMobile ? undefined : { position: 'fixed', top: position.top, left: position.left, right: 'auto', zIndex: 300 }}
      >
        <div className="dropdown-item" onClick={() => onShowMembers(channelName)}>{t('app.members')}</div>
        <div className="dropdown-item" onClick={() => onEdit(channelName)}>{t('app.edit')}</div>
        <div className="dropdown-item" onClick={handleZip}>{t('app.downloadZip')}</div>
        <div className="dropdown-item danger" onClick={handleDelete}>{t('app.deleteChannel')}</div>
      </div>
    </>
  );
}

/* ============================================================
 * ChannelRoute — loads posts when channel changes
 * ============================================================ */

const PAGE_SIZE = 8;

function ChannelRoute() {
  const { channel } = useParams<{ channel: string }>();
  const { selectChannel, setPosts, setHasMorePosts } = useAppStore();

  useEffect(() => {
    if (!channel) return;
    selectChannel(channel);
    api.getPosts(channel, { limit: PAGE_SIZE }).then(posts => {
      setPosts(posts);
      setHasMorePosts(posts.length >= PAGE_SIZE);
    }).catch(console.error);
  }, [channel]);

  return (
    <>
      <ChannelView />
      <Composer />
    </>
  );
}

/* ============================================================
 * AppContent — Router inside BrowserRouter
 * ============================================================ */

function AppContent() {
  const { authRequired, channels, setChannels, setAuth, setOpenRegistration, setAuthRequired, setCurrentUser } = useAppStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [initialized, setInitialized] = useState(false);
  const [showRegister, setShowRegister] = useState(false);

  // Initialize API on mount
  useEffect(() => {
    (async () => {
      await initApi();
      // Sync API state to store
      setOpenRegistration(openRegistration);

      const token = getToken();
      const user = getCurrentUser();
      if (token) {
        setAuth(token, user);
      }

      // Listen for auth-required events
      const handleAuthRequired = () => setAuthRequired(true);
      window.addEventListener('milagram:auth-required', handleAuthRequired);

      // Load channels
      if (isMockMode) {
        // Mock mode — no auth needed, load channels directly
        const chs = await api.getChannels();
        setChannels(chs);
      } else if (token) {
        try {
          const chs = await api.getChannels();
          setChannels(chs);
        } catch { /* will trigger auth-required */ }
      } else {
        setAuthRequired(true);
      }

      setInitialized(true);
      return () => window.removeEventListener('milagram:auth-required', handleAuthRequired);
    })();
  }, []);

  // Sync sidebar-open class to body for CSS desktop layout
  useEffect(() => {
    document.body.classList.toggle('sidebar-open', useAppStore.getState().sidebarOpen);
    const unsub = useAppStore.subscribe((state) => {
      document.body.classList.toggle('sidebar-open', state.sidebarOpen);
    });
    return unsub;
  }, []);

  // After login, navigate to first channel
  const handleAuthSuccess = useCallback(async () => {
    setAuthRequired(false);
    setShowRegister(false);
    await initApi();
    setOpenRegistration(openRegistration);
    const user = getCurrentUser();
    if (user) setCurrentUser(user);

    const chs = await api.getChannels();
    setChannels(chs);
    if (chs.length > 0 && (location.pathname === '/' || location.pathname.startsWith('/invite'))) {
      navigate(`/c/${chs[0].name}`);
    }
  }, [navigate, location.pathname]);

  if (!initialized) {
    return (
      <div className="login-screen" style={{ display: 'flex' }}>
        <div className="loading-dots"><span></span><span></span><span></span></div>
      </div>
    );
  }

  // Invite route — show regardless of auth
  if (location.pathname.match(/^\/invite\//)) {
    return <InviteScreen onSuccess={handleAuthSuccess} />;
  }

  // Auth required
  if (authRequired) {
    if (showRegister) {
      return <RegisterScreen onSuccess={handleAuthSuccess} onShowLogin={() => setShowRegister(false)} />;
    }
    return <LoginScreen onSuccess={handleAuthSuccess} onShowRegister={() => setShowRegister(true)} />;
  }

  return (
    <div>
      <Header />
      <Sidebar />
      <Lightbox />
      <Routes>
        <Route path="/c/_admin" element={<AdminPanel />} />
        <Route path="/c/_profile" element={<ProfilePage />} />
        <Route path="/c/:channel" element={<ChannelRoute />} />
        <Route path="/" element={
          channels.length > 0
            ? <Navigate to={`/c/${channels[0].name}`} replace />
            : <EmptyState />
        } />
        <Route path="*" element={
          channels.length > 0
            ? <Navigate to={`/c/${channels[0].name}`} replace />
            : <Navigate to="/" replace />
        } />
      </Routes>
    </div>
  );
}

function EmptyState() {
  const { t } = useTranslation();
  return (
    <div className="empty-state" style={{ display: 'flex' }}>
      <div className="empty-state-icon">📝</div>
      <div className="empty-state-title">{t('app.noChannels')}</div>
      <div className="empty-state-text">{t('app.createFirst')}</div>
    </div>
  );
}

/* ============================================================
 * App — root component
 * ============================================================ */

export function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
