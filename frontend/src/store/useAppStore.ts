import { create } from 'zustand';
import type { Category, PoseListItem, Toast } from '../types';

interface AppState {
  // Categories
  categories: Category[];
  setCategories: (categories: Category[]) => void;

  // Poses
  poses: PoseListItem[];
  setPoses: (poses: PoseListItem[]) => void;

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
}

export const useAppStore = create<AppState>((set) => ({
  // Categories
  categories: [],
  setCategories: (categories) => set({ categories }),

  // Poses
  poses: [],
  setPoses: (poses) => set({ poses }),

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
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, duration);
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  // Sidebar
  isSidebarOpen: true,
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setSidebarOpen: (isSidebarOpen) => set({ isSidebarOpen }),
}));
