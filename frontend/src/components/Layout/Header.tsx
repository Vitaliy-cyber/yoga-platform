import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Loader2 } from "lucide-react";
import { useSearchPoses } from "../../hooks/usePoses";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";
import { getImageProxyUrl } from "../../services/api";


export const Header: React.FC = () => {
  const navigate = useNavigate();
  const { results, isSearching, search } = useSearchPoses();
  const [searchQuery, setSearchQuery] = useState("");
  const [showResults, setShowResults] = useState(false);


  const handleSearch = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const query = e.target.value;
      setSearchQuery(query);
      search(query);
      setShowResults(query.length > 0);
    },
    [search]
  );

  const handleSelectResult = useCallback(
    (poseId: number) => {
      setShowResults(false);
      setSearchQuery("");
      navigate(`/poses/${poseId}`);
    },
    [navigate]
  );

  return (
    <header className="sticky top-0 z-40 w-full glass border-b-0">
      <div className="flex h-16 items-center px-6 gap-4">
        {/* Search Bar */}
        <div className="flex-1 max-w-lg relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Пошук поз..."
              className="pl-9 bg-secondary/50 border-transparent focus:bg-background focus:border-input transition-all"
              value={searchQuery}
              onChange={handleSearch}
              onFocus={() => {
                searchQuery && setShowResults(true);
              }}
              onBlur={() => {
                setTimeout(() => setShowResults(false), 200);
              }}
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>

          {/* Results Dropdown */}
          <div
            className={cn(
              "absolute top-full left-0 right-0 mt-2 rounded-xl border bg-card/95 backdrop-blur-md shadow-lg overflow-hidden z-50 transition-all duration-150",
              showResults ? "opacity-100 translate-y-0 pointer-events-auto" : "opacity-0 -translate-y-1 pointer-events-none"
            )}
          >
            <div className="max-h-[300px] overflow-y-auto p-1">
              {results.length > 0 ? (
                results.map((pose) => (
                  <button
                    key={pose.id}
                    onClick={() => handleSelectResult(pose.id)}
                    className="flex items-center gap-3 w-full p-2 hover:bg-accent rounded-lg transition-colors duration-150 text-left group"
                  >
                    {pose.photo_path ? (
                      <img src={getImageProxyUrl(pose.id, 'photo')} alt={pose.name} className="w-10 h-10 rounded-md object-cover bg-secondary" />
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
                <div className="p-4 text-center text-sm text-muted-foreground">
                  Нічого не знайдено
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex items-center gap-2">
          {/* Could add notifications or theme toggle here */}
        </div>
      </div>
    </header>
  );
};
