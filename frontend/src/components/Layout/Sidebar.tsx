import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { NavLink, useSearchParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  Grid,
  Upload,
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
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { useAuthStore } from "../../store/useAuthStore";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";
import { CategoryModal, CategoryEditModal, CategoryDeleteModal } from "../Category";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import type { Category } from "../../types";

const navItems = [
  { path: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { path: "/poses", icon: Grid, labelKey: "nav.gallery" },
  { path: "/sequences", icon: Layers, labelKey: "nav.sequences" },
  { path: "/upload", icon: Upload, labelKey: "nav.upload" },
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
  // Use individual selectors for better re-render optimization and subscription
  const categories = useAppStore((state) => state.categories);
  const theme = useAppStore((state) => state.theme);
  const toggleTheme = useAppStore((state) => state.toggleTheme);
  const { user, logout } = useAuthStore();
  const { t } = useI18n();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
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
          <div className="flex items-center justify-between px-4 mb-4">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">{t("nav.categories")}</h3>
            <button
              onClick={() => setShowCategoryModal(true)}
              className="p-1 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
              title={t("nav.add_category")}
              aria-label={t("nav.add_category")}
            >
              <Plus size={16} />
            </button>
          </div>
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
                  <li key={category.id} className="group/item relative">
                    <NavLink
                      to={`/poses?category=${category.id}`}
                      className={() =>
                        cn(
                          "flex items-center justify-between px-4 py-2.5 rounded-lg text-sm transition-colors group",
                          isActive
                            ? "bg-accent/50 text-foreground font-medium"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent/30",
                          category.pose_count === 0 && "opacity-50"
                        )
                      }
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <FolderOpen size={16} className="text-primary/70 flex-shrink-0" />
                        <span className="truncate">{category.name}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        {category.pose_count !== undefined && (
                          <span className="text-xs bg-background/50 px-2 py-0.5 rounded-full border border-white/5 group-hover/item:mr-7 transition-all">
                            {category.pose_count}
                          </span>
                        )}
                      </div>
                    </NavLink>
                    {/* Category Actions Menu */}
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 transition-opacity">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            className="p-1.5 rounded-md hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                            onClick={(e) => e.preventDefault()}
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-36">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.preventDefault();
                              setEditingCategory(category);
                            }}
                          >
                            <Pencil size={14} className="mr-2" />
                            {t("category.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.preventDefault();
                              setDeletingCategory(category);
                            }}
                            className="text-destructive focus:text-destructive"
                          >
                            <Trash2 size={14} className="mr-2" />
                            {t("category.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
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

      {/* Category Creation Modal */}
      <CategoryModal
        open={showCategoryModal}
        onOpenChange={setShowCategoryModal}
      />

      {/* Category Edit Modal */}
      <CategoryEditModal
        category={editingCategory}
        open={!!editingCategory}
        onOpenChange={(open) => !open && setEditingCategory(null)}
      />

      {/* Category Delete Modal */}
      <CategoryDeleteModal
        category={deletingCategory}
        open={!!deletingCategory}
        onOpenChange={(open) => !open && setDeletingCategory(null)}
      />
    </aside>
  );
};
