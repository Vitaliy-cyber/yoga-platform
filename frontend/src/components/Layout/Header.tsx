import React, { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Search, Loader2, LogOut, User } from "lucide-react";
import { useSearchPoses } from "../../hooks/usePoses";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { PoseImage } from "../Pose";
import { useAuthStore } from "../../store/useAuthStore";
import { useViewTransition } from "../../hooks/useViewTransition";
import { useI18n } from "../../i18n";


export const Header: React.FC = () => {
  const navigate = useNavigate();
  const { results, isSearching, search } = useSearchPoses();
  const [searchQuery, setSearchQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const { user, logout } = useAuthStore();
  const { t, locale, setLocale } = useI18n();
  const { startTransition } = useViewTransition();
  const resultsRef = useRef<HTMLDivElement>(null);

  const handleLogout = useCallback(() => {
    logout();
    navigate("/login", { replace: true });
  }, [logout, navigate]);


  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchQuery(query);
      search(query);
      setShowResults(query.length > 0);
      setActiveIndex(-1);
    },
    [search]
  );

  const handleSelectResult = useCallback(
    (poseId: number) => {
      setShowResults(false);
      setSearchQuery("");
      setActiveIndex(-1);
      navigate(`/poses/${poseId}`);
    },
    [navigate]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (!showResults || results.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
          break;
        case "ArrowUp":
          e.preventDefault();
          setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
          break;
        case "Enter":
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < results.length) {
            handleSelectResult(results[activeIndex].id);
          }
          break;
        case "Escape":
          setShowResults(false);
          setActiveIndex(-1);
          break;
      }
    },
    [showResults, results, activeIndex, handleSelectResult]
  );

  return (
    <header className="sticky top-0 z-40 w-full glass border-b-0">
      <div className="flex h-16 items-center px-6 gap-4">
        {/* Search Bar */}
        <div className="flex-1 max-w-lg relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t("header.search_placeholder")}
                className="pl-9 bg-secondary/50 border-transparent focus:bg-background focus:border-input transition-all"
                value={searchQuery}
                onChange={handleSearch}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                  searchQuery && setShowResults(true);
                }}
                onBlur={() => {
                  setTimeout(() => setShowResults(false), 200);
                }}
                role="combobox"
                aria-expanded={showResults}
                aria-controls="search-results"
                aria-activedescendant={activeIndex >= 0 ? `search-result-${activeIndex}` : undefined}
                aria-autocomplete="list"
                aria-label={t("header.search_placeholder")}
              />

            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Results Dropdown */}
          <AnimatePresence>
            {showResults && (
              <motion.div
                ref={resultsRef}
                id="search-results"
                role="listbox"
                aria-label={t("header.search_results")}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="absolute top-full left-0 right-0 mt-2 rounded-xl border bg-card/95 backdrop-blur-md shadow-lg overflow-hidden z-50"
              >
                <div className="max-h-[300px] overflow-y-auto p-1">
                  {results.length > 0 ? (
                    results.map((pose, index) => (
                      <button
                        key={pose.id}
                        id={`search-result-${index}`}
                        role="option"
                        aria-selected={index === activeIndex}
                        onClick={() => handleSelectResult(pose.id)}
                        className={cn(
                          "flex items-center gap-3 w-full p-2 rounded-lg transition-colors duration-150 text-left group",
                          index === activeIndex
                            ? "bg-accent text-accent-foreground"
                            : "hover:bg-accent"
                        )}
                      >
                        {pose.photo_path ? (
                          <PoseImage
                            poseId={pose.id}
                            imageType="photo"
                            directPath={pose.photo_path}
                            alt={pose.name}
                            className="w-10 h-10 rounded-md object-cover bg-secondary"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-md bg-secondary flex items-center justify-center">
                            <Search className="h-4 w-4 text-muted-foreground" />
                          </div>
                        )}
                        <div className="flex-1 overflow-hidden">
                          <p className="text-sm font-medium truncate group-hover:text-primary transition-colors duration-150">{pose.name}</p>
                          <p className="text-xs text-muted-foreground truncate opacity-70">
                            {pose.category_name} • #{pose.code}
                          </p>
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="p-4 text-center text-sm text-muted-foreground" role="status">
                      {t("header.no_results")}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Right Actions - User Menu */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void startTransition(() => setLocale(locale === "ua" ? "en" : "ua"))}
            className="text-muted-foreground hover:text-foreground hover:bg-accent"
            aria-label={t("app.language_toggle")}
          >
            {t("app.language_toggle")}
          </Button>
          {user && (
            <div className="flex items-center gap-3">
              <div className="hidden sm:flex items-center gap-2 text-sm">
                <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
                <span className="text-muted-foreground max-w-[120px] truncate">
                  {user.name || `User #${user.id}`}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="text-muted-foreground hover:text-foreground hover:bg-accent"
                aria-label={t("app.logout")}
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden sm:inline ml-2">{t("app.logout")}</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
