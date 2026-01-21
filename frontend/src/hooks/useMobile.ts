import { useState, useEffect } from "react";

export interface UseMediaQueryOptions {
  defaultValue?: boolean;
}

/**
 * Custom hook for responsive breakpoint detection using matchMedia API.
 * Provides reactive updates when screen size changes.
 *
 * Breakpoints:
 * - Mobile: < 640px
 * - Tablet: 640px - 1024px
 * - Desktop: > 1024px
 *
 * SSR Safety: Always initializes with defaultValue on server to prevent
 * hydration mismatches. The actual value is set only after mounting.
 */

const IS_SERVER = typeof window === "undefined";

// Custom hook for media query matching
function useMediaQuery(
  query: string,
  options: UseMediaQueryOptions = {}
): boolean {
  const { defaultValue = false } = options;

  // Always initialize with defaultValue to prevent SSR hydration mismatch
  // The actual value will be set after mount in the useEffect
  const [matches, setMatches] = useState<boolean>(defaultValue);

  useEffect(() => {
    if (IS_SERVER) {
      return;
    }

    const mediaQueryList = window.matchMedia(query);

    // Set initial value only on client after mount
    setMatches(mediaQueryList.matches);

    // Handler for media query changes
    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    // Modern browsers
    if (mediaQueryList.addEventListener) {
      mediaQueryList.addEventListener("change", handleChange);
      return () => {
        mediaQueryList.removeEventListener("change", handleChange);
      };
    } else {
      // Legacy support for older browsers
      mediaQueryList.addListener(handleChange);
      return () => {
        mediaQueryList.removeListener(handleChange);
      };
    }
  }, [query]);

  return matches;
}

export interface UseMobileReturn {
  /** True when screen width < 640px */
  isMobile: boolean;
  /** True when screen width is 640px - 1024px */
  isTablet: boolean;
  /** True when screen width > 1024px */
  isDesktop: boolean;
  /** True when screen width < 768px (typical mobile menu breakpoint) */
  isMobileMenu: boolean;
  /** True when screen width < 1024px (mobile + tablet) */
  isTouchDevice: boolean;
}

/**
 * Hook for detecting device type based on screen width.
 * Uses standard Tailwind CSS breakpoints.
 *
 * @example
 * ```tsx
 * const { isMobile, isTablet, isDesktop } = useMobile();
 *
 * if (isMobile) {
 *   return <MobileNav />;
 * }
 * return <Sidebar />;
 * ```
 */
export function useMobile(): UseMobileReturn {
  // Standard Tailwind breakpoints
  const isMobile = useMediaQuery("(max-width: 639px)");
  const isTablet = useMediaQuery("(min-width: 640px) and (max-width: 1023px)");
  const isDesktop = useMediaQuery("(min-width: 1024px)");

  // Mobile menu breakpoint: matches Tailwind's md: (768px)
  // Use max-width: 767px so isMobileMenu=true when width < 768px
  // This aligns with CSS "hidden md:flex" (hidden below 768px, flex at 768px+)
  const isMobileMenu = useMediaQuery("(max-width: 767px)");

  // Combined mobile + tablet for touch-optimized interfaces
  const isTouchDevice = useMediaQuery("(max-width: 1023px)");

  return {
    isMobile,
    isTablet,
    isDesktop,
    isMobileMenu,
    isTouchDevice,
  };
}

// Export useMediaQuery for custom breakpoints
export { useMediaQuery };
