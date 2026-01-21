import React from "react";
import { ArrowLeft, Globe, User, Calendar } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { useI18n } from "../i18n";
import { useAuthStore } from "../store/useAuthStore";
import { useViewTransition } from "../hooks/useViewTransition";
import { cn } from "../lib/utils";

export const Settings: React.FC = () => {
  const { t, locale, setLocale, formatDate } = useI18n();
  const { startTransition } = useViewTransition();
  const user = useAuthStore((state) => state.user);

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border sticky top-0 z-40">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 py-3 sm:py-4">
          <div className="flex items-center gap-3">
            <Link to="/">
              <Button variant="ghost" size="icon" className="h-10 w-10">
                <ArrowLeft className="w-5 h-5" />
              </Button>
            </Link>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">
              {t("settings.title")}
            </h1>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Account Section */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <User className="w-5 h-5 text-muted-foreground" />
            {t("settings.account")}
          </h2>

          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-full bg-gradient-to-tr from-rose-500 to-orange-500 flex items-center justify-center text-white text-xl font-bold shadow-md">
                {user?.name?.charAt(0).toUpperCase() || "U"}
              </div>
              <div>
                <p className="font-medium text-foreground">
                  {user?.name || `User #${user?.id || "?"}`}
                </p>
                {user?.created_at && (
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Calendar className="w-4 h-4" />
                    {t("settings.member_since")}: {formatDate(user.created_at)}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Language Section */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
            <Globe className="w-5 h-5 text-muted-foreground" />
            {t("settings.language")}
          </h2>

          <p className="text-sm text-muted-foreground mb-4">
            {t("settings.language_description")}
          </p>

          <div className="flex gap-3">
            <button
              onClick={() => startTransition(() => setLocale("en"))}
              className={cn(
                "flex-1 py-3 px-4 rounded-xl border-2 transition-all duration-200 text-left",
                locale === "en"
                  ? "border-primary bg-muted"
                  : "border-border hover:border-border/80"
              )}
            >
              <span className="text-2xl mb-1 block">🇬🇧</span>
              <span className="font-medium text-foreground">English</span>
            </button>
            <button
              onClick={() => startTransition(() => setLocale("ua"))}
              className={cn(
                "flex-1 py-3 px-4 rounded-xl border-2 transition-all duration-200 text-left",
                locale === "ua"
                  ? "border-primary bg-muted"
                  : "border-border hover:border-border/80"
              )}
            >
              <span className="text-2xl mb-1 block">🇺🇦</span>
              <span className="font-medium text-foreground">Українська</span>
            </button>
          </div>
        </section>

        {/* App Info Section */}
        <section className="bg-card rounded-2xl border border-border p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            {t("settings.about")}
          </h2>

          <div className="space-y-2 text-sm text-muted-foreground">
            <p><span className="font-medium text-foreground">YogaFlow</span> - {t("settings.app_description")}</p>
            <p>{t("settings.version")}: 1.0.0</p>
          </div>
        </section>
      </main>
    </div>
  );
};
