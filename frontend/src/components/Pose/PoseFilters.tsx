import React, { useState, useEffect, useCallback } from "react";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Search } from "lucide-react";
import { useI18n } from "../../i18n";
import { useDebounce } from "../../hooks/useDebounce";

interface PoseFiltersProps {
  filters: {
    search: string;
    category: string;
    status: string;
  };
  categories: { id: number; name: string }[];
  onFilterChange: (filters: { search: string; category: string; status: string }) => void;
  /** Debounce delay for search input in milliseconds (default: 300ms) */
  searchDebounceMs?: number;
}

export const PoseFilters: React.FC<PoseFiltersProps> = ({
  filters,
  categories,
  onFilterChange,
  searchDebounceMs = 300,
}) => {
  const { t } = useI18n();
  const statuses = [
    { value: "all", label: t("pose.filters.all_statuses") },
    { value: "draft", label: t("pose.filters.draft") },
    { value: "complete", label: t("pose.filters.complete") },
  ];

  // Local state for immediate input feedback
  const [localSearch, setLocalSearch] = useState(filters.search);

  // Debounced search value - only updates after user stops typing
  const debouncedSearch = useDebounce(localSearch, searchDebounceMs);

  // Sync local state when filters.search changes externally
  useEffect(() => {
    setLocalSearch(filters.search);
  }, [filters.search]);

  // Trigger filter change when debounced value changes
  useEffect(() => {
    if (debouncedSearch !== filters.search) {
      onFilterChange({ ...filters, search: debouncedSearch });
    }
  }, [debouncedSearch, filters, onFilterChange]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSearch(e.target.value);
  }, []);

  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder={t("pose.filters.search")}
          value={localSearch}
          onChange={handleSearchChange}
          className="pl-10"
          aria-label={t("pose.filters.search")}
        />
      </div>

      <div className="flex gap-3">
        <Select
          value={filters.category}
          onValueChange={(value) => onFilterChange({ ...filters, category: value })}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t("pose.filters.category")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("pose.filters.all_categories")}</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat.id} value={String(cat.id)}>
                {cat.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status}
          onValueChange={(value) => onFilterChange({ ...filters, status: value })}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder={t("pose.filters.status")} />
          </SelectTrigger>
          <SelectContent>
            {statuses.map((status) => (
              <SelectItem key={status.value} value={status.value}>
                {status.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
