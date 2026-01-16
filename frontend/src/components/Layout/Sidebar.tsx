import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Grid,
  Upload,
  Wand2,
  FolderOpen,
  Sparkles,
  Settings
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { categoriesApi } from "../../services/api";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";

const navItems = [
  { path: "/", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { path: "/poses", icon: Grid, labelKey: "nav.gallery" },
  { path: "/upload", icon: Upload, labelKey: "nav.upload" },
  { path: "/generate", icon: Wand2, labelKey: "nav.generate" },
] as const;

export const Sidebar: React.FC = () => {
  const location = useLocation();
  const { categories, setCategories } = useAppStore();
  const { t } = useI18n();

  React.useEffect(() => {
    const fetchCategories = async () => {
      try {
        const data = await categoriesApi.getAll();
        setCategories(data);
      } catch (error) {
        console.error(t("categories.fetch_failed"), error);
      }
    };
    fetchCategories();
  }, [setCategories, t]);

  return (
    <aside className="w-72 h-screen sticky top-0 flex flex-col glass border-r border-white/10 z-50 transition-all duration-300">
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
      <div className="flex-1 overflow-y-auto py-6 px-4 space-y-8 scrollbar-hide">
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
          <ul className="space-y-1">
            {categories.map((category) => (
              <li key={category.id}>
                <NavLink
                  to={`/poses?category=${category.id}`}
                  className={() =>
                    cn(
                      "flex items-center justify-between px-4 py-2.5 rounded-lg text-sm transition-colors group",
                      location.search === `?category=${category.id}`
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
            ))}
          </ul>
        </section>
      </div>

      {/* User / Footer Area */}
      <div className="p-4 border-t border-white/5 bg-black/5">
        <button className="flex items-center gap-3 w-full p-3 rounded-xl hover:bg-accent/50 transition-colors text-left group">
          <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-rose-500 to-orange-500 flex items-center justify-center text-white font-bold shadow-md">
            T
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors">{t("nav.user_name")}</p>
            <p className="text-xs text-muted-foreground">{t("nav.user_plan")}</p>
          </div>
          <Settings size={18} className="text-muted-foreground group-hover:text-primary transition-colors" />
        </button>
      </div>
    </aside>
  );
};
