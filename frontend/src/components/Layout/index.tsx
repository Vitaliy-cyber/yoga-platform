import React, { useEffect } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { MobileNav } from "./MobileNav";
import { CompareBar } from "../Compare/CompareBar";
import { GenerationFloatingWidget } from "../Generation/GenerationFloatingWidget";
import { useSelectedPoseCount } from "../../store/useCompareStore";
import { useCategories } from "../../hooks/useCategories";
import { useI18n } from "../../i18n";

export const Layout: React.FC = () => {
  const location = useLocation();
  const selectedCount = useSelectedPoseCount();
  const { t } = useI18n();

  // Fetch categories once at the Layout level to prevent duplicate API calls
  // The categories are stored in useAppStore and shared by Sidebar and MobileNav
  const {
    isLoading: categoriesLoading,
    error: categoriesError,
    refetch: refetchCategories,
  } = useCategories();

  // Don't show compare bar on the compare page itself
  const isComparePage = location.pathname === "/compare";
  const showCompareBar = selectedCount > 0 && !isComparePage;

  // Scroll to top on route change
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background flex">
      {/* Skip to main content link for accessibility */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-4 focus:left-4 focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {t("nav.skip_to_content")}
      </a>

      {/* Desktop Sidebar - hidden on mobile via CSS */}
      <Sidebar
        isLoading={categoriesLoading}
        error={categoriesError}
        onRetry={refetchCategories}
      />

      {/* Mobile Navigation - hidden on desktop via CSS */}
      <MobileNav
        isLoading={categoriesLoading}
        error={categoriesError}
        onRetry={refetchCategories}
      />

      {/* Main Content Area */}
      <main id="main-content" className="flex-1 min-w-0" tabIndex={-1}>
        {/* Add padding-top on mobile to account for the hamburger button */}
        {/* Add padding-bottom when compare bar is visible */}
        <div className={`md:pt-0 pt-16 ${showCompareBar ? "pb-20" : ""}`}>
          <Outlet />
        </div>
      </main>

      {/* Compare Bar - fixed at bottom when poses are selected */}
      <AnimatePresence initial={false}>
        {showCompareBar && <CompareBar />}
      </AnimatePresence>
      <GenerationFloatingWidget />
    </div>
  );
};
