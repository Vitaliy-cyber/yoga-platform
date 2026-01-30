/**
 * Hook for using the View Transitions API with a fallback.
 *
 * View Transitions provide smooth animations when DOM changes occur,
 * making state changes and navigation feel more polished.
 */

import { useCallback, useRef } from 'react';

// Simplified ViewTransition interface for cross-browser compatibility
interface SimpleViewTransition {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition(): void;
}

// Check if View Transitions API is supported
export const supportsViewTransitions = (): boolean =>
  typeof document !== 'undefined' &&
  'startViewTransition' in document;

const isSkippedTransitionError = (error: unknown): boolean => {
  if (error instanceof DOMException) {
    if (error.name === 'AbortError') {
      return true;
    }
    if (typeof error.message === 'string' && error.message.includes('Skipped ViewTransition')) {
      return true;
    }
  }
  return false;
};

const swallowTransitionRejection = (promise: Promise<void>): void => {
  void promise.catch((error) => {
    if (!isSkippedTransitionError(error)) {
      console.error("ViewTransition promise rejected", error);
    }
  });
};

const observeTransitionPromises = (transition: SimpleViewTransition): void => {
  swallowTransitionRejection(transition.ready);
  swallowTransitionRejection(transition.updateCallbackDone);
};

interface ViewTransitionOptions {
  /**
   * Whether to use View Transitions. Defaults to true if supported.
   */
  enabled?: boolean;
  /**
   * Callback to run when transition is skipped (if cleanup needed).
   */
  onSkipped?: () => void;
}

/**
 * Hook that wraps state changes in View Transitions for smooth animations.
 * Falls back to immediate execution if View Transitions are not supported.
 *
 * @example
 * ```tsx
 * const { startTransition } = useViewTransition();
 *
 * const handleClick = () => {
 *   startTransition(() => {
 *     setShowResults(true);
 *   });
 * };
 * ```
 */
export function useViewTransition(options: ViewTransitionOptions = {}) {
  const { enabled = true, onSkipped } = options;
  const transitionRef = useRef<SimpleViewTransition | null>(null);

  const startTransition = useCallback(
    (updateCallback: () => void | Promise<void>) => {
      // Skip if disabled or not supported
      if (!enabled || !supportsViewTransitions()) {
        updateCallback();
        onSkipped?.();
        return Promise.resolve();
      }

      // Cancel any ongoing transition
      if (transitionRef.current) {
        const previousTransition = transitionRef.current;
        try {
          previousTransition.skipTransition();
        } catch {
          // Ignore errors during skip
        }
        void previousTransition.finished.catch(() => undefined);
        observeTransitionPromises(previousTransition);
        transitionRef.current = null;
      }

      // Start new view transition
      const transition = document.startViewTransition(async () => {
        await updateCallback();
      }) as unknown as SimpleViewTransition;

      observeTransitionPromises(transition);
      transitionRef.current = transition;

      return transition.finished
        .catch((error) => {
          if (isSkippedTransitionError(error)) {
            return;
          }
          throw error;
        })
        .finally(() => {
          if (transitionRef.current === transition) {
            transitionRef.current = null;
          }
        });
    },
    [enabled, onSkipped]
  );

  const skipTransition = useCallback(() => {
    if (transitionRef.current) {
      const currentTransition = transitionRef.current;
      try {
        currentTransition.skipTransition();
      } catch {
        // Ignore errors during skip
      }
      void currentTransition.finished.catch(() => undefined);
      observeTransitionPromises(currentTransition);
      transitionRef.current = null;
    }
  }, []);

  return {
    startTransition,
    skipTransition,
    isSupported: supportsViewTransitions(),
  };
}

/**
 * Utility to wrap a callback in a view transition.
 * Useful for one-off transitions without the hook.
 */
export function withViewTransition(
  callback: () => void | Promise<void>
): Promise<void> {
  if (!supportsViewTransitions()) {
    callback();
    return Promise.resolve();
  }

  const transition = document.startViewTransition(async () => {
    await callback();
  }) as unknown as SimpleViewTransition;

  observeTransitionPromises(transition);

  return transition.finished.catch((error) => {
    if (isSkippedTransitionError(error)) {
      return;
    }
    throw error;
  });
}
