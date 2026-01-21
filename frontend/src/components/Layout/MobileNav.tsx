import React, { useEffect, useMemo, useState, useCallback } from "react";
import { NavLink, useLocation, useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Grid,
  Upload,
  Wand2,
  FolderOpen,
  Sparkles,
  Settings,
  Menu,
  X,
  BarChart3,
  Loader2,
  LogOut,
  ChevronUp,
  Sun,
  Moon,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useAuthStore } from "../../store/useAuthStore";
import { useViewTransition } from "../../hooks/useViewTransition";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "../ui/sheet";
import { Button } from "../ui/button";
import { VisuallyHidden } from "../ui/visually-hidden";

const navItems = [
  { path: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { path: "/poses", icon: Grid, labelKey: "nav.gallery" },
  { path: "/upload", icon: Upload, labelKey: "nav.upload" },
  { path: "/generate", icon: Wand2, labelKey: "nav.generate" },
  { path: "/analytics", icon: BarChart3, labelKey: "nav.analytics" },
] as const;

interface MobileNavProps {
  className?: string;
  isLoading?: boolean;
  error?: string | null;
}

export const MobileNav: React.FC<MobileNavProps> = ({ className, isLoading = false, error = null }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { categories, theme, toggleTheme } = useAppStore();
  const { user, logout } = useAuthStore();
  const { t } = useI18n();
  const { startTransition } = useViewTransition();
  const [isOpen, setIsOpen] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);

  const handleLogout = useCallback(() => {
    logout();
    setIsOpen(false);
    navigate("/login", { replace: true });
  }, [logout, navigate]);

  // Get current category from URL search params using URLSearchParams (issue 11)
  const currentCategoryId = useMemo(() => {
    return searchParams.get("category");
  }, [searchParams]);

  // Close menu on route change - use onOpenChange from Sheet instead of manual onClick
  // This prevents race conditions (issue 5)
  useEffect(() => {
    setIsOpen(false);
  }, [location.pathname, location.search]);

  return (
    <div className={cn("md:hidden", className)}>
      {/* Hamburger Button - Fixed position at top-left */}
      {/* z-45 to stay above sidebar (z-40) but below sheet overlay (z-60) */}
      <Button
        variant="ghost"
        size="icon"
        onClick={() => startTransition(() => setIsOpen(true))}
        className="fixed top-3 left-3 z-[45] h-11 w-11 min-h-[44px] min-w-[44px] bg-card/95 backdrop-blur-sm shadow-md border rounded-xl hover:bg-accent active:scale-95 transition-all"
        aria-label={t("nav.open_menu")}
      >
        <Menu className="h-5 w-5 text-foreground" />
      </Button>

      {/* Sheet/Drawer */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="left"
          className="w-[300px] max-w-[85vw] p-0 bg-gradient-to-b from-muted to-card"
          hideCloseButton
        >
          {/* Accessible title and description - visually hidden (issue 4) */}
          <VisuallyHidden>
            <SheetTitle>{t("nav.menu")}</SheetTitle>
            <SheetDescription>{t("nav.menu_description")}</SheetDescription>
          </VisuallyHidden>

          {/* Header */}
          <div className="flex items-center justify-between p-5 pb-4 border-b">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-stone-800 to-stone-600 flex items-center justify-center shadow-lg">
                <Sparkles className="text-white w-5 h-5" />
              </div>
              <div>
                <h1 className="font-sans font-bold text-lg text-foreground tracking-tight">
                  YogaFlow
                </h1>
                <p className="text-xs text-muted-foreground">{t("nav.premium")}</p>
              </div>
            </div>
            <SheetClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 min-h-[44px] min-w-[44px] rounded-xl hover:bg-accent"
                aria-label={t("nav.close_menu")}
              >
                <X className="h-5 w-5 text-muted-foreground" />
              </Button>
            </SheetClose>
          </div>

          {/* Navigation Content */}
          <div className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
            {/* Main Menu */}
            <section>
              <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                {t("nav.menu")}
              </h3>
              <ul className="space-y-1">
                {navItems.map((item) => (
                  <li key={item.path}>
                    {/* Removed manual onClick - useEffect handles closing on route change (issue 5) */}
                    <NavLink
                      to={item.path}
                      className={({ isActive }) =>
                        cn(
                          "flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all duration-200 min-h-[48px] touch-manipulation",
                          isActive
                            ? "text-primary-foreground bg-primary shadow-md"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/80"
                        )
                      }
                    >
                      <item.icon size={22} />
                      <span className="font-medium text-base">
                        {t(item.labelKey)}
                      </span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </section>

            {/* Categories */}
            <section>
              <h3 className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
                {t("nav.categories")}
              </h3>
              {/* Loading state (issue 12) */}
              {isLoading && (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">{t("common.loading")}</span>
                </div>
              )}
              {/* Error state */}
              {error && !isLoading && (
                <div className="px-4 py-3 text-sm text-red-600">
                  {error}
                </div>
              )}
              {/* Categories list */}
              {!isLoading && !error && categories.length > 0 && (
                <ul className="space-y-1">
                  {categories.map((category) => {
                    // Use URLSearchParams for proper category matching (issue 11)
                    const isActive = currentCategoryId === String(category.id);
                    return (
                      <li key={category.id}>
                        {/* Removed manual onClick - useEffect handles closing on route change (issue 5) */}
                        <NavLink
                          to={`/poses?category=${category.id}`}
                          className={() =>
                            cn(
                              "flex items-center justify-between px-4 py-3 rounded-xl text-sm transition-colors min-h-[44px] touch-manipulation",
                              isActive
                                ? "bg-accent text-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground hover:bg-accent/50 active:bg-accent"
                            )
                          }
                        >
                          <div className="flex items-center gap-3">
                            <FolderOpen size={18} className="text-muted-foreground" />
                            <span>{category.name}</span>
                          </div>
                          {category.pose_count !== undefined && (
                            <span className="text-xs bg-muted px-2.5 py-1 rounded-full text-muted-foreground">
                              {category.pose_count}
                            </span>
                          )}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              )}
              {/* Empty state */}
              {!isLoading && !error && categories.length === 0 && (
                <div className="px-4 py-3 text-sm text-muted-foreground">
                  {t("nav.no_categories")}
                </div>
              )}
            </section>
          </div>

          {/* Footer / User Area */}
          <div className="p-4 border-t bg-muted/50 safe-area-pb relative">
            {/* User Menu Dropdown */}
            <AnimatePresence>
              {showUserMenu && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="absolute bottom-full left-4 right-4 mb-2 rounded-xl border bg-card shadow-lg overflow-hidden z-50"
                >
                  <div className="p-1">
                    <button
                      onClick={() => {
                        toggleTheme();
                      }}
                      className="flex items-center gap-3 w-full p-3.5 rounded-lg hover:bg-accent transition-colors text-left min-h-[48px] touch-manipulation"
                    >
                      {theme === "light" ? (
                        <Moon size={20} className="text-muted-foreground" />
                      ) : (
                        <Sun size={20} className="text-muted-foreground" />
                      )}
                      <span className="text-sm font-medium text-foreground">
                        {theme === "light" ? t("nav.dark_mode") : t("nav.light_mode")}
                      </span>
                    </button>
                    <button
                      onClick={() => {
                        startTransition(() => setShowUserMenu(false));
                        setIsOpen(false);
                        navigate("/settings");
                      }}
                      className="flex items-center gap-3 w-full p-3.5 rounded-lg hover:bg-accent transition-colors text-left min-h-[48px] touch-manipulation"
                    >
                      <Settings size={20} className="text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">{t("nav.settings")}</span>
                    </button>
                    <button
                      onClick={handleLogout}
                      className="flex items-center gap-3 w-full p-3.5 rounded-lg hover:bg-red-50 hover:text-red-600 transition-colors text-left min-h-[48px] touch-manipulation"
                    >
                      <LogOut size={20} />
                      <span className="text-sm font-medium">{t("app.logout")}</span>
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* User Button */}
            <button
              onClick={() => startTransition(() => setShowUserMenu(!showUserMenu))}
              className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-accent active:bg-accent/80 transition-colors text-left min-h-[56px] touch-manipulation"
              aria-label={t("nav.user_settings")}
              aria-expanded={showUserMenu}
              aria-haspopup="menu"
            >
              <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-rose-500 to-orange-500 flex items-center justify-center text-white font-bold shadow-md">
                {user?.name?.charAt(0).toUpperCase() || "U"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {user?.name || `User #${user?.id || "?"}`}
                </p>
                <p className="text-xs text-muted-foreground">{t("nav.user_plan")}</p>
              </div>
              <motion.div
                animate={{ rotate: showUserMenu ? 0 : 180 }}
                transition={{ duration: 0.2 }}
              >
                <ChevronUp
                  size={20}
                  className="text-muted-foreground flex-shrink-0"
                />
              </motion.div>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};
