import { create } from 'zustand';
import type { Toast } from '../types';

// Map to store toast timer refs for cleanup on manual remove
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
}

/**
 * Separate store for toast notifications.
 *
 * This store is intentionally separate from the main app store to prevent
 * unnecessary re-renders. When toasts are added/removed, only components
 * that subscribe to this store will re-render, not the entire app.
 *
 * Usage:
 * ```tsx
 * // In a component that displays toasts
 * const { toasts, removeToast } = useToastStore();
 *
 * // In a component that adds toasts
 * const addToast = useToastStore((state) => state.addToast);
 * addToast({ type: 'success', message: 'Operation completed!' });
 * ```
 */
export const useToastStore = create<ToastState>((set) => ({
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
}));

/**
 * Hook to get just the addToast function without subscribing to toast state.
 * This prevents re-renders when toasts change for components that only add toasts.
 *
 * Usage:
 * ```tsx
 * const addToast = useAddToast();
 * addToast({ type: 'error', message: 'Something went wrong' });
 * ```
 */
export const useAddToast = () => useToastStore((state) => state.addToast);
