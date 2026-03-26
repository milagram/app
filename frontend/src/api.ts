/**
 * Data Access Layer — types, adapters, authentication
 *
 * One file contains everything for data access:
 * - TypeScript interfaces (Post, Channel, MediaFile, User)
 * - Token management (localStorage + cookie sync)
 * - HttpAdapter (FastAPI backend)
 * - MockAdapter (demo mode without server)
 * - Auth functions (login, register, invite)
 * - Backend auto-detection
 */

import i18n from './i18n';

/* ============================================================
 * Types
 * ============================================================ */

export interface MediaFile {
  name: string;
  url?: string;
  fileObj?: File;
  size?: number;
  type?: 'media' | 'file';
}

export interface Post {
  basename: string;
  created_at: string;
  title: string;
  text: string;
  files: MediaFile[];
  channel?: string;
  author?: string;
  hidden?: boolean;
}

export interface PostInput {
  title: string;
  text: string;
  files: MediaFile[];
  basename?: string;
  customDate?: string;
  hidden?: boolean;
}

export interface Channel {
  name: string;
  display_name?: string;
  description?: string;
  emoji?: string;
  post_count?: number;
  created_at?: string;
  visibility?: 'public' | 'private';
  my_role?: 'owner' | 'editor' | 'viewer';
}

export interface User {
  id: string;
  username: string;
  display_name?: string;
  is_admin?: boolean;
}

/** Upload progress callback. */
export type UploadProgressCallback = (info: {
  stage: 'preparing' | 'uploading' | 'processing';
  percent: number;        // 0..100 for uploading stage
  bytesLoaded?: number;
  bytesTotal?: number;
}) => void;

export interface ApiAdapter {
  getChannels(): Promise<Channel[]>;
  createChannel(channel: Partial<Channel>): Promise<Channel>;
  updateChannel(name: string, data: Partial<Channel>): Promise<Channel>;
  deleteChannel(name: string): Promise<void>;

  getPosts(channel: string, opts?: { limit?: number; before?: string; search?: string }): Promise<Post[]>;
  createPost(channel: string, post: PostInput, onProgress?: UploadProgressCallback): Promise<Post>;
  updatePost(channel: string, oldBasename: string, post: PostInput, onProgress?: UploadProgressCallback): Promise<Post>;
  deletePost(channel: string, basename: string): Promise<void>;
  getMediaUrl(channel: string, post: Post, file: MediaFile, thumb?: boolean): string;

  // Templates
  getTemplates(channel: string): Promise<string[]>;
  saveTemplates(channel: string, templates: string[]): Promise<string[]>;

  // Multi-user
  getChannelMembers?(channel: string): Promise<any[]>;
  addChannelMember?(channel: string, userId: string, role: string): Promise<any>;
  removeChannelMember?(channel: string, userId: string): Promise<any>;
  createInvite?(channel: string, options?: any): Promise<any>;
  listInvites?(channel: string): Promise<any[]>;
  deleteInvite?(token: string): Promise<any>;
  listUsers?(): Promise<any[]>;
  getAdminSettings?(): Promise<any>;
  updateAdminSettings?(settings: any): Promise<any>;
  adminCreateUser?(data: any): Promise<any>;
  adminDeleteUser?(userId: string): Promise<any>;
  getAdminStats?(): Promise<any>;
}

/* ============================================================
 * Config
 * ============================================================ */

const CONFIG = {
  useBackend: 'auto' as 'auto' | true | false,
  backendUrl: window.location.origin,
};

/* ============================================================
 * Token management
 * ============================================================ */

const TOKEN_KEY = 'milagram_token';
const USER_KEY = 'milagram_user';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
  syncAuthCookie(token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  document.cookie = 'milagram_auth=; Max-Age=0; path=/; SameSite=Lax';
}

function syncAuthCookie(token: string) {
  if (!token) return;
  const maxAge = 365 * 86400;
  document.cookie = `milagram_auth=${encodeURIComponent(token)}; Max-Age=${maxAge}; path=/; SameSite=Lax`;
}

export function getCurrentUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setCurrentUser(user: User | null) {
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

/* ============================================================
 * Auth helpers
 * ============================================================ */

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers = { ...extra };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = authHeaders(options.headers as Record<string, string> || {});
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearToken();
    window.dispatchEvent(new CustomEvent('milagram:auth-required'));
    throw new Error('Unauthorized');
  }
  return res;
}

/**
 * Upload FormData via XMLHttpRequest with progress tracking
 * Falls back to regular authFetch if no onProgress callback
 */
function authUpload(
  method: string,
  url: string,
  fd: FormData,
  onProgress?: UploadProgressCallback,
): Promise<any> {
  // No progress needed — use simple fetch
  if (!onProgress) {
    return authFetch(url, { method, body: fd }).then(res => {
      if (!res.ok) throw new Error(`${method} ${url} → ${res.status}`);
      return res.json();
    });
  }

  onProgress({ stage: 'preparing', percent: 0 });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);

    // Auth header
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    // Upload progress
    xhr.upload.addEventListener('progress', (e) => {
      if (e.lengthComputable) {
        onProgress({
          stage: 'uploading',
          percent: Math.round((e.loaded / e.total) * 100),
          bytesLoaded: e.loaded,
          bytesTotal: e.total,
        });
      }
    });

    // Upload complete — waiting for server response
    xhr.upload.addEventListener('load', () => {
      onProgress({ stage: 'processing', percent: 100 });
    });

    xhr.addEventListener('load', () => {
      if (xhr.status === 401) {
        clearToken();
        window.dispatchEvent(new CustomEvent('milagram:auth-required'));
        reject(new Error('Unauthorized'));
        return;
      }
      if (xhr.status >= 400) {
        reject(new Error(`${method} ${url} → ${xhr.status}`));
        return;
      }
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch {
        resolve(null);
      }
    });

    xhr.addEventListener('error', () => {
      reject(new Error(i18n.t('upload.networkError')));
    });

    xhr.addEventListener('timeout', () => {
      reject(new Error(i18n.t('upload.timeout')));
    });

    xhr.addEventListener('abort', () => {
      reject(new Error(i18n.t('upload.cancelled')));
    });

    // 5 minute timeout for large files
    xhr.timeout = 5 * 60 * 1000;

    xhr.send(fd);
  });
}

/* ============================================================
 * HttpAdapter
 * ============================================================ */

export class HttpAdapter implements ApiAdapter {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  // --- Channels ---

  async getChannels(): Promise<Channel[]> {
    const res = await authFetch(`${this.baseUrl}/api/channels`);
    if (!res.ok) throw new Error(`GET /api/channels → ${res.status}`);
    return res.json();
  }

  async createChannel(channel: Partial<Channel>): Promise<Channel> {
    const res = await authFetch(`${this.baseUrl}/api/channels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(channel),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `POST /api/channels → ${res.status}`);
    }
    return res.json();
  }

  async updateChannel(name: string, data: Partial<Channel>): Promise<Channel> {
    const res = await authFetch(`${this.baseUrl}/api/channels/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...data }),
    });
    if (!res.ok) throw new Error(`PUT /api/channels/${name} → ${res.status}`);
    return res.json();
  }

  async deleteChannel(name: string): Promise<void> {
    const res = await authFetch(`${this.baseUrl}/api/channels/${name}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE /api/channels/${name} → ${res.status}`);
  }

  // --- Posts ---

  async getPosts(channel: string, opts?: { limit?: number; before?: string; search?: string }): Promise<Post[]> {
    const params = new URLSearchParams();
    if (opts?.limit) params.set('limit', String(opts.limit));
    if (opts?.before) params.set('before', opts.before);
    if (opts?.search) params.set('search', opts.search);
    const qs = params.toString();
    const res = await authFetch(`${this.baseUrl}/api/channels/${channel}/posts${qs ? '?' + qs : ''}`);
    if (!res.ok) throw new Error(`GET /api/channels/${channel}/posts → ${res.status}`);
    return res.json();
  }

  async createPost(channel: string, post: PostInput, onProgress?: UploadProgressCallback): Promise<Post> {
    const fd = new FormData();
    fd.append('title', post.title || '');
    fd.append('text', post.text || '');
    if (post.customDate) fd.append('date', post.customDate);
    if (post.hidden) fd.append('hidden', 'true');
    for (const f of post.files) {
      if (f.fileObj) fd.append('files', f.fileObj, f.name);
    }
    return authUpload('POST', `${this.baseUrl}/api/channels/${channel}/posts`, fd, onProgress);
  }

  async updatePost(channel: string, oldBasename: string, post: PostInput, onProgress?: UploadProgressCallback): Promise<Post> {
    const fd = new FormData();
    fd.append('title', post.title || '');
    fd.append('text', post.text || '');
    if (post.basename) fd.append('basename', post.basename);
    if (post.hidden) fd.append('hidden', 'true');
    for (const f of post.files) {
      if (f.fileObj) fd.append('files', f.fileObj, f.name);
    }
    const retained = post.files.filter(f => !f.fileObj).map(f => f.name);
    fd.append('retained_files', JSON.stringify(retained));

    return authUpload('PUT', `${this.baseUrl}/api/channels/${channel}/posts/${oldBasename}`, fd, onProgress);
  }

  async deletePost(channel: string, basename: string): Promise<void> {
    const res = await authFetch(`${this.baseUrl}/api/channels/${channel}/posts/${basename}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`DELETE /api/channels/${channel}/posts/${basename} → ${res.status}`);
  }

  getMediaUrl(channel: string, post: Post, file: MediaFile, thumb?: boolean): string {
    const base = `${this.baseUrl}/posts/${channel}/${post.basename}/${file.name}`;
    return thumb ? `${base}?w=300` : base;
  }

  // --- Templates ---

  async getTemplates(channel: string): Promise<string[]> {
    const res = await authFetch(`${this.baseUrl}/api/channels/${channel}/templates`);
    if (!res.ok) return [];
    return res.json();
  }

  async saveTemplates(channel: string, templates: string[]): Promise<string[]> {
    const res = await authFetch(`${this.baseUrl}/api/channels/${channel}/templates`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(templates),
    });
    if (!res.ok) throw new Error('Failed to save templates');
    return res.json();
  }

  // --- Members ---

  async getChannelMembers(channel: string) {
    const res = await authFetch(`${this.baseUrl}/api/channels/${channel}/members`);
    if (!res.ok) throw new Error(`GET /api/channels/${channel}/members → ${res.status}`);
    return res.json();
  }

  async addChannelMember(channel: string, userId: string, role: string) {
    const res = await authFetch(`${this.baseUrl}/api/channels/${channel}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, role }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `POST /api/channels/${channel}/members → ${res.status}`);
    }
    return res.json();
  }

  async removeChannelMember(channel: string, userId: string) {
    const res = await authFetch(`${this.baseUrl}/api/channels/${channel}/members/${userId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error(`DELETE members/${userId} → ${res.status}`);
    return res.json();
  }

  // --- Invites ---

  async createInvite(channel: string, options: any = {}) {
    const res = await authFetch(`${this.baseUrl}/api/channels/${channel}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        role: options.role || 'viewer',
        max_uses: options.max_uses || 1,
        expires_in_days: options.expires_in_days || null,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `POST invite → ${res.status}`);
    }
    return res.json();
  }

  async listInvites(channel: string) {
    const res = await authFetch(`${this.baseUrl}/api/channels/${channel}/invites`);
    if (!res.ok) throw new Error(`GET invites → ${res.status}`);
    return res.json();
  }

  async deleteInvite(token: string) {
    const res = await authFetch(`${this.baseUrl}/api/invites/${token}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`DELETE invite → ${res.status}`);
    return res.json();
  }

  // --- Admin ---

  async listUsers() {
    const res = await authFetch(`${this.baseUrl}/api/users`);
    if (!res.ok) throw new Error(`GET /api/users → ${res.status}`);
    return res.json();
  }

  async getAdminSettings() {
    const res = await authFetch(`${this.baseUrl}/api/admin/settings`);
    if (!res.ok) throw new Error(`GET admin/settings → ${res.status}`);
    return res.json();
  }

  async updateAdminSettings(settings: any) {
    const res = await authFetch(`${this.baseUrl}/api/admin/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error(`PUT admin/settings → ${res.status}`);
    return res.json();
  }

  async adminCreateUser(data: any) {
    const res = await authFetch(`${this.baseUrl}/api/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `POST admin/users → ${res.status}`);
    }
    return res.json();
  }

  async adminDeleteUser(userId: string) {
    const res = await authFetch(`${this.baseUrl}/api/admin/users/${userId}`, { method: 'DELETE' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || `DELETE admin/users → ${res.status}`);
    }
    return res.json();
  }

  async getAdminStats() {
    const res = await authFetch(`${this.baseUrl}/api/admin/stats`);
    if (!res.ok) throw new Error(`GET admin/stats → ${res.status}`);
    return res.json();
  }
}

/* ============================================================
 * MockAdapter
 * ============================================================ */

const DEMO_CHANNELS: Channel[] = [
  { name: 'family', display_name: i18n.t('demo.familyName'), description: i18n.t('demo.familyDesc'), emoji: '👨‍👩‍👧', post_count: 2, created_at: '2026-03-20T08:00:00+03:00' },
  { name: 'health', display_name: i18n.t('demo.healthName'), description: i18n.t('demo.healthDesc'), emoji: '💊', post_count: 0, created_at: '2026-03-20T08:00:00+03:00' },
];

const DEMO_POSTS: Record<string, Post[]> = {
  family: [
    {
      basename: '20260320_083000',
      created_at: '2026-03-20T08:30:00+03:00',
      title: '',
      text: 'Выпил витамин D и Омега-3. #таблетки #здоровье',
      files: [],
      channel: 'family',
    },
    {
      basename: '20260320_101500_progulka',
      created_at: '2026-03-20T10:15:00+03:00',
      title: 'Утренняя прогулка',
      text: 'Теперь интерфейс по-настоящему минималистичный:\n- Убраны лишние рамки\n- Время встроено в карточку\n- Нижняя панель ввода парит\n\n> Красота в простоте! #семья',
      files: [
        { url: 'https://picsum.photos/600/400?random=1', name: 'park1.jpg' },
        { url: 'https://picsum.photos/600/400?random=2', name: 'park2.jpg' },
      ],
      channel: 'family',
    },
  ],
  health: [],
};

export class MockAdapter implements ApiAdapter {
  private channels: Channel[];
  private channelPosts: Record<string, Post[]>;

  constructor() {
    this.channels = structuredClone(DEMO_CHANNELS);
    this.channelPosts = structuredClone(DEMO_POSTS);
  }

  async getChannels() { return [...this.channels]; }

  async createChannel(channel: Partial<Channel>) {
    const ch: Channel = {
      name: channel.name!,
      display_name: channel.display_name || '',
      description: channel.description || '',
      emoji: channel.emoji || '',
      post_count: 0,
      created_at: new Date().toISOString(),
    };
    this.channels.push(ch);
    this.channelPosts[ch.name] = [];
    return ch;
  }

  async updateChannel(name: string, data: Partial<Channel>) {
    const ch = this.channels.find(c => c.name === name);
    if (ch) {
      ch.display_name = data.display_name || '';
      ch.description = data.description || '';
      ch.emoji = data.emoji || '';
    }
    return ch!;
  }

  async deleteChannel(name: string) {
    this.channels = this.channels.filter(c => c.name !== name);
    delete this.channelPosts[name];
  }

  async getPosts(channel: string, opts?: { limit?: number; before?: string; search?: string }) {
    let posts = this.channelPosts[channel] || [];
    posts = [...posts].sort((a, b) => a.basename.localeCompare(b.basename));
    if (opts?.search) {
      const q = opts.search.toLowerCase();
      posts = posts.filter(p => ((p.title || '') + ' ' + (p.text || '')).toLowerCase().includes(q));
      return posts;
    }
    if (opts?.before) posts = posts.filter(p => p.basename < opts.before!);
    if (opts?.limit && opts.limit > 0 && posts.length > opts.limit) {
      const cutoff = posts[posts.length - opts.limit];
      const cutoffDay = cutoff.basename.substring(0, 8);
      posts = posts.filter(p => p.basename.substring(0, 8) >= cutoffDay);
    }
    return posts;
  }

  async createPost(channel: string, post: PostInput, _onProgress?: UploadProgressCallback): Promise<Post> {
    const p: Post = { ...post, basename: post.basename || '', created_at: new Date().toISOString(), channel };
    if (!this.channelPosts[channel]) this.channelPosts[channel] = [];
    this.channelPosts[channel].push(p);
    return p;
  }

  async updatePost(channel: string, oldBasename: string, post: PostInput, _onProgress?: UploadProgressCallback): Promise<Post> {
    const posts = this.channelPosts[channel] || [];
    const idx = posts.findIndex(p => p.basename === oldBasename);
    const updated: Post = { ...post, basename: post.basename || oldBasename, created_at: posts[idx]?.created_at || '', channel };
    if (idx !== -1) posts[idx] = updated;
    return updated;
  }

  async deletePost(channel: string, basename: string) {
    if (this.channelPosts[channel]) {
      this.channelPosts[channel] = this.channelPosts[channel].filter(p => p.basename !== basename);
    }
  }

  getMediaUrl(_channel: string, _post: Post, file: MediaFile, _thumb?: boolean) {
    return file.url || '';
  }

  private mockTemplates: Record<string, string[]> = {};

  async getTemplates(channel: string) {
    return this.mockTemplates[channel] || [];
  }

  async saveTemplates(channel: string, templates: string[]) {
    this.mockTemplates[channel] = templates;
    return templates;
  }
}

/* ============================================================
 * Adapter factory + Auth functions
 * ============================================================ */

export let api: ApiAdapter;
export let openRegistration = true;
export let isMockMode = false;

export async function initApi(): Promise<ApiAdapter> {
  if (CONFIG.useBackend === true) {
    api = new HttpAdapter(CONFIG.backendUrl);
    return api;
  }
  if (CONFIG.useBackend === false) {
    api = new MockAdapter();
    isMockMode = true;
    return api;
  }

  // Auto-detect
  try {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${CONFIG.backendUrl}/api/auth/check`, {
      headers,
      signal: AbortSignal.timeout(2000),
    });

    if (res.ok) {
      const data = await res.json();
      if (data.open_registration !== undefined) openRegistration = data.open_registration;
      if (data.user) setCurrentUser(data.user);

      if (data.authRequired && !data.authenticated) {
        window.dispatchEvent(new CustomEvent('milagram:auth-required', {
          detail: {},
        }));
      }

      if (data.authenticated && token) syncAuthCookie(token);
      api = new HttpAdapter(CONFIG.backendUrl);
      return api;
    }
  } catch { /* no backend */ }

  api = new MockAdapter();
  isMockMode = true;
  return api;
}

export async function login(password: string, username?: string) {
  const body: any = { password };
  if (username) body.username = username;

  const res = await fetch(`${CONFIG.backendUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Login failed');
  }
  const data = await res.json();
  setToken(data.token);
  if (data.user) setCurrentUser(data.user);
  return data;
}

export async function register(username: string, password: string, displayName?: string) {
  const res = await fetch(`${CONFIG.backendUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, display_name: displayName || '' }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Registration failed');
  }
  const data = await res.json();
  setToken(data.token);
  if (data.user) setCurrentUser(data.user);
  return data;
}

export async function getInviteInfo(token: string) {
  const res = await fetch(`${CONFIG.backendUrl}/api/invite/${token}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Invalid invite');
  }
  return res.json();
}

export async function acceptInvite(inviteToken: string, credentials?: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const authToken = getToken();
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`;

  const res = await fetch(`${CONFIG.backendUrl}/api/invite/${inviteToken}/accept`, {
    method: 'POST',
    headers,
    body: JSON.stringify(credentials || {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || 'Failed to accept invite');
  }
  const data = await res.json();
  setToken(data.token);
  if (data.user) setCurrentUser(data.user);
  return data;
}

export function logout() {
  fetch('/api/logout', { method: 'POST' }).catch(() => {});
  clearToken();
  window.location.reload();
}
