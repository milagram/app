/**
 * Zustand store — all application state in one place
 *
 * What is stored:
 * - Auth: token, user, mode (multi/single)
 * - Channels: list, current
 * - Posts: list for current channel, filter
 * - UI: sidebar, meta toggle, editing state
 *
 * Some fields are persisted in localStorage (persist)
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Channel, Post, User } from './api';

interface LightboxState {
  isOpen: boolean;
  postIndex: number;
  fileIndex: number;
}

interface AppState {
  // Auth
  token: string | null;
  currentUser: User | null;
  openRegistration: boolean;
  authRequired: boolean;

  // Channels
  channels: Channel[];
  currentChannel: string | null;

  // Posts
  posts: Post[];
  hasMorePosts: boolean;
  activeFilter: string;
  searchQuery: string;

  // UI
  sidebarOpen: boolean;
  showMeta: boolean;
  editingPost: Post | null;
  editingIndex: number | null;

  // Lightbox
  lightbox: LightboxState;

  // Actions — Auth
  setAuth: (token: string, user?: User | null) => void;
  clearAuth: () => void;
  setOpenRegistration: (open: boolean) => void;
  setAuthRequired: (required: boolean) => void;
  setCurrentUser: (user: User | null) => void;

  // Actions — Channels
  setChannels: (channels: Channel[]) => void;
  selectChannel: (name: string | null) => void;

  // Actions — Posts
  setPosts: (posts: Post[]) => void;
  prependPosts: (older: Post[]) => void;
  setHasMorePosts: (has: boolean) => void;
  addPost: (post: Post) => void;
  updatePost: (basename: string, updated: Post) => void;
  removePost: (basename: string) => void;
  setFilter: (tag: string) => void;
  setSearchQuery: (query: string) => void;

  // Actions — UI
  toggleSidebar: () => void;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleMeta: () => void;
  startEdit: (post: Post, index: number) => void;
  clearEdit: () => void;

  // Actions — Lightbox
  openLightbox: (postIndex: number, fileIndex: number) => void;
  closeLightbox: () => void;
  setLightboxIndex: (postIndex: number, fileIndex: number) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Initial state
      token: null,
      currentUser: null,
      openRegistration: true,
      authRequired: false,
      channels: [],
      currentChannel: null,
      posts: [],
      hasMorePosts: true,
      activeFilter: 'all',
      searchQuery: '',
      sidebarOpen: true,
      showMeta: false,
      editingPost: null,
      editingIndex: null,
      lightbox: { isOpen: false, postIndex: 0, fileIndex: 0 },

      // Auth
      setAuth: (token, user) => set({ token, currentUser: user || null, authRequired: false }),
      clearAuth: () => set({ token: null, currentUser: null }),
      setOpenRegistration: (open) => set({ openRegistration: open }),
      setAuthRequired: (required) => set({ authRequired: required }),
      setCurrentUser: (user) => set({ currentUser: user }),

      // Channels
      setChannels: (channels) => set({ channels }),
      selectChannel: (name) => set({ currentChannel: name, posts: [], hasMorePosts: true, activeFilter: 'all', searchQuery: '', editingPost: null, editingIndex: null }),

      // Posts
      setPosts: (posts) => set({ posts }),
      prependPosts: (older) => set((s) => {
        // Deduplicate by basename
        const existing = new Set(s.posts.map(p => p.basename));
        const unique = older.filter(p => !existing.has(p.basename));
        return { posts: [...unique, ...s.posts] };
      }),
      setHasMorePosts: (has) => set({ hasMorePosts: has }),
      addPost: (post) => set((s) => ({ posts: [...s.posts, post] })),
      updatePost: (basename, updated) => set((s) => ({
        posts: s.posts.map(p => p.basename === basename ? updated : p),
      })),
      removePost: (basename) => set((s) => ({
        posts: s.posts.filter(p => p.basename !== basename),
      })),
      setFilter: (tag) => set({ activeFilter: tag, searchQuery: '' }),
      setSearchQuery: (query) => set({ searchQuery: query }),

      // UI
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      openSidebar: () => set({ sidebarOpen: true }),
      closeSidebar: () => set({ sidebarOpen: false }),
      toggleMeta: () => set((s) => ({ showMeta: !s.showMeta })),
      startEdit: (post, index) => set({ editingPost: post, editingIndex: index }),
      clearEdit: () => set({ editingPost: null, editingIndex: null }),

      // Lightbox
      openLightbox: (postIndex, fileIndex) => set({
        lightbox: { isOpen: true, postIndex, fileIndex },
      }),
      closeLightbox: () => set((s) => ({
        lightbox: { ...s.lightbox, isOpen: false },
      })),
      setLightboxIndex: (postIndex, fileIndex) => set({
        lightbox: { isOpen: true, postIndex, fileIndex },
      }),
    }),
    {
      name: 'milagram',
      partialize: (state) => ({
        token: state.token,
        currentUser: state.currentUser,
        sidebarOpen: state.sidebarOpen,
        showMeta: state.showMeta,
      }),
    },
  ),
);
