import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { NavLink, useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Grid,
  Upload,
  Wand2,
  FolderOpen,
  Sparkles,
  Settings,
  BarChart3,
  Layers,
  Loader2,
  LogOut,
  ChevronUp,
  Sun,
  Moon,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useAuthStore } from "../../store/useAuthStore";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";

const navItems = [
  { path: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { path: "/poses", icon: Grid, labelKey: "nav.gallery" },
  { path: "/sequences", icon: Layers, labelKey: "nav.sequences" },
  { path: "/upload", icon: Upload, labelKey: "nav.upload" },
  { path: "/generate", icon: Wand2, labelKey: "nav.generate" },
  { path: "/analytics", icon: BarChart3, labelKey: "nav.analytics" },
] as const;

interface SidebarProps {
  className?: string;
  isLoading?: boolean;
  error?: string | null;
}

export const Sidebar: React.FC<SidebarProps> = ({ className, isLoading = false, error = null }) => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { categories, theme, toggleTheme } = useAppStore();
  const { user, logout } = useAuthStore();
  const { t } = useI18n();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLogout = useCallback(() => {
    logout();
    navigate("/login", { replace: true });
  }, [logout, navigate]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Get current category from URL search params using URLSearchParams (issue 11)
  const currentCategoryId = useMemo(() => {
    return searchParams.get("category");
  }, [searchParams]);

  return (
    <aside className={cn(
      // z-40 for sidebar (issue 6: z-index scale)
      "w-72 h-screen sticky top-0 flex-col glass border-r border-white/10 z-40 transition-all duration-300",
      // Hide on mobile, show on desktop (md breakpoint = 768px)
      "hidden md:flex",
      className
    )}>
      <div className="absolute inset-0 bg-gradient-to-b from-white/5 to-transparent pointer-events-none" />
      {/* Logo Area */}
      <div className="p-8 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-violet-500 flex items-center justify-center shadow-lg shadow-primary/25">
            <Sparkles className="text-white w-5 h-5" />
          </div>
          <div>
            <h1 className="font-sans font-bold text-xl text-foreground tracking-tight">YogaFlow</h1>
            <p className="text-xs text-muted-foreground">{t("nav.premium")}</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className={cn(
        "flex-1 overflow-y-auto py-6 px-4 space-y-8 scrollbar-hide",
        showUserMenu && "pointer-events-none"
      )}>
        {/* Main Menu */}
        <section>
            <h3 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">{t("nav.menu")}</h3>

          <ul className="space-y-2">
            {navItems.map((item) => (
              <li key={item.path}>
                  <NavLink
                  to={item.path}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group relative overflow-hidden",
                      isActive
                        ? "text-primary-foreground shadow-lg shadow-primary/20 bg-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                    )
                  }
                >
                  <item.icon size={20} />
                  <span className="font-medium">{t(item.labelKey)}</span>
                </NavLink>
              </li>
            ))}
          </ul>
        </section>

        {/* Categories */}
        <section>
          <h3 className="px-4 text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-4">{t("nav.categories")}</h3>
          {/* Loading state (issue 12) */}
          {isLoading && (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">{t("common.loading")}</span>
            </div>
          )}
          {/* Error state */}
          {error && !isLoading && (
            <div className="px-4 py-3 text-sm text-red-500">
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
                    <NavLink
                      to={`/poses?category=${category.id}`}
                      className={() =>
                        cn(
                          "flex items-center justify-between px-4 py-2.5 rounded-lg text-sm transition-colors group",
                          isActive
                            ? "bg-accent/50 text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/30"
                        )
                      }
                    >
                      <div className="flex items-center gap-3">
                        <FolderOpen size={16} className="text-primary/70" />
                        <span>{category.name}</span>
                      </div>
                      {category.pose_count !== undefined && (
                        <span className="text-xs bg-background/50 px-2 py-0.5 rounded-full border border-white/5">
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

      {/* User / Footer Area */}
      <div className="p-4 border-t border-white/5 bg-black/5 relative" ref={menuRef}>
        {/* Dropdown Menu */}
        <AnimatePresence>
          {showUserMenu && (
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full left-4 right-4 mb-2 rounded-xl border bg-card/95 backdrop-blur-md shadow-lg overflow-hidden z-50"
            >
              <div className="p-1">
                <button
                  onClick={() => {
                    toggleTheme();
                  }}
                  className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-accent transition-colors text-left"
                >
                  {theme === "light" ? (
                    <Moon size={18} className="text-muted-foreground" />
                  ) : (
                    <Sun size={18} className="text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium">
                    {theme === "light" ? t("nav.dark_mode") : t("nav.light_mode")}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setShowUserMenu(false);
                    navigate("/settings");
                  }}
                  className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-accent transition-colors text-left"
                >
                  <Settings size={18} className="text-muted-foreground" />
                  <span className="text-sm font-medium">{t("nav.settings")}</span>
                </button>
                <button
                  onClick={handleLogout}
                  className="flex items-center gap-3 w-full p-3 rounded-lg hover:bg-red-500/10 hover:text-red-500 transition-colors text-left"
                >
                  <LogOut size={18} />
                  <span className="text-sm font-medium">{t("app.logout")}</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* User Button */}
        <button
          onClick={() => setShowUserMenu(!showUserMenu)}
          className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-accent/50 transition-colors text-left group"
          aria-label={t("nav.user_settings")}
          aria-expanded={showUserMenu}
          aria-haspopup="menu"
        >
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-rose-500 to-orange-500 flex items-center justify-center text-white font-bold shadow-md">
            {user?.name?.charAt(0).toUpperCase() || "U"}
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">
              {user?.name || `User #${user?.id || "?"}`}
            </p>
            <p className="text-xs text-muted-foreground">{t("nav.user_plan")}</p>
          </div>
          <motion.div
            animate={{ rotate: showUserMenu ? 0 : 180 }}
            transition={{ duration: 0.2 }}
          >
            <ChevronUp
              size={18}
              className="text-muted-foreground group-hover:text-primary transition-colors"
            />
          </motion.div>
        </button>
      </div>
    </aside>
  );
};
