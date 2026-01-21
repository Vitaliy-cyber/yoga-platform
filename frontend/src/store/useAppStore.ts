import { create } from 'zustand';
import type { Category, PoseListItem, Toast } from '../types';

// Map to track active toast timers for cleanup on manual removal
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

// Staleness threshold - data older than this is considered stale (30 seconds)
// This helps with multi-tab scenarios where one tab might have outdated data
const STALE_TIME_MS = 30 * 1000;

type Theme = 'light' | 'dark';

// Get initial theme from localStorage or system preference
const getInitialTheme = (): Theme => {
  if (typeof window === 'undefined') return 'light';
  const stored = localStorage.getItem('yoga-platform-theme');
  if (stored === 'light' || stored === 'dark') return stored;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

interface AppState {
  // Theme
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;

  // Categories
  categories: Category[];
  categoriesFetchedAt: number | null;
  setCategories: (categories: Category[]) => void;
  isCategoriesStale: () => boolean;
  invalidateCategories: () => void;

  // Poses
  poses: PoseListItem[];
  posesFetchedAt: number | null;
  setPoses: (poses: PoseListItem[]) => void;
  isPosesStale: () => boolean;
  invalidatePoses: () => void;

  // Selected category filter
  selectedCategoryId: number | null;
  setSelectedCategoryId: (id: number | null) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (query: string) => void;

  // Loading states
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;

  // Toasts
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;

  // Sidebar
  isSidebarOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;

  // Cross-tab sync - invalidate all data (useful for cross-tab communication)
  invalidateAll: () => void;
}

// Apply theme class to document
const applyTheme = (theme: Theme) => {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('light', 'dark');
    document.documentElement.classList.add(theme);
    localStorage.setItem('yoga-platform-theme', theme);
  }
};

export const useAppStore = create<AppState>((set, get) => ({
  // Theme
  theme: getInitialTheme(),
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
  toggleTheme: () => {
    const newTheme = get().theme === 'light' ? 'dark' : 'light';
    applyTheme(newTheme);
    set({ theme: newTheme });
  },

  // Categories with staleness tracking
  categories: [],
  categoriesFetchedAt: null,
  setCategories: (categories) => set({
    categories,
    categoriesFetchedAt: Date.now(),
  }),
  isCategoriesStale: () => {
    const { categoriesFetchedAt } = get();
    if (!categoriesFetchedAt) return true;
    return Date.now() - categoriesFetchedAt > STALE_TIME_MS;
  },
  invalidateCategories: () => set({
    categoriesFetchedAt: null,
  }),

  // Poses with staleness tracking
  poses: [],
  posesFetchedAt: null,
  setPoses: (poses) => set({
    poses,
    posesFetchedAt: Date.now(),
  }),
  isPosesStale: () => {
    const { posesFetchedAt } = get();
    if (!posesFetchedAt) return true;
    return Date.now() - posesFetchedAt > STALE_TIME_MS;
  },
  invalidatePoses: () => set({
    posesFetchedAt: null,
  }),

  // Selected category filter
  selectedCategoryId: null,
  setSelectedCategoryId: (selectedCategoryId) => set({ selectedCategoryId }),

  // Search
  searchQuery: '',
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  // Loading states
  isLoading: false,
  setIsLoading: (isLoading) => set({ isLoading }),

  // Toasts
  toasts: [],
  addToast: (toast) => {
    const id = Math.random().toString(36).substring(7);
    set((state) => ({
      toasts: [...state.toasts, { ...toast, id }],
    }));

    // Auto remove after duration
    const duration = toast.duration || 5000;
    const timerId = setTimeout(() => {
      // Clean up timer from map when it fires
      toastTimers.delete(id);
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, duration);

    // Store timer ref for cleanup on manual remove
    toastTimers.set(id, timerId);
  },
  removeToast: (id) => {
    // Clear the auto-remove timer if it exists
    const timerId = toastTimers.get(id);
    if (timerId) {
      clearTimeout(timerId);
      toastTimers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }));
  },

  // Sidebar
  isSidebarOpen: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),

  // Invalidate all data - useful for cross-tab sync or after major changes
  invalidateAll: () => set({
    categoriesFetchedAt: null,
    posesFetchedAt: null,
  }),
}));

// Cross-tab communication: listen for storage events to invalidate cache
// This helps keep multiple tabs in sync when one tab makes changes
if (typeof window !== 'undefined') {
  // Apply initial theme on load
  applyTheme(getInitialTheme());

  // Listen for custom invalidation events from other tabs
  window.addEventListener('storage', (event) => {
    if (event.key === 'yoga-platform-invalidate') {
      const store = useAppStore.getState();
      store.invalidateAll();
    }
    // Sync theme across tabs
    if (event.key === 'yoga-platform-theme' && event.newValue) {
      const theme = event.newValue as Theme;
      if (theme === 'light' || theme === 'dark') {
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(theme);
        useAppStore.setState({ theme });
      }
    }
  });

  // Also listen for visibility changes - refetch stale data when tab becomes visible
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      // Tab became visible - data consumers will check staleness on next render
      // This is handled by the hooks that use isCategoriesStale/isPosesStale
    }
  });
}

// Helper function to broadcast invalidation to other tabs
export function broadcastInvalidation(): void {
  if (typeof window !== 'undefined') {
    // Using localStorage to communicate between tabs
    // Set and immediately remove to trigger storage event in other tabs
    localStorage.setItem('yoga-platform-invalidate', Date.now().toString());
    localStorage.removeItem('yoga-platform-invalidate');
  }
}
