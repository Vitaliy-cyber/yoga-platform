import React from "react";
import { Input } from "../ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Search } from "lucide-react";
import { useI18n } from "../../i18n";

interface PoseFiltersProps {
  filters: {
    search: string;
    category: string;
    status: string;
  };
  categories: { id: number; name: string }[];
  onFilterChange: (filters: { search: string; category: string; status: string }) => void;
}

export const PoseFilters: React.FC<PoseFiltersProps> = ({ filters, categories, onFilterChange }) => {
  const { t } = useI18n();
  const statuses = [
    { value: "all", label: t("pose.filters.all_statuses") },
    { value: "draft", label: t("pose.filters.draft") },
    { value: "complete", label: t("pose.filters.complete") },
  ];

  return (
    <div className="flex flex-col sm:flex-row gap-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-400" />
        <Input
          placeholder={t("pose.filters.search")}
          value={filters.search}
          onChange={(e) => onFilterChange({ ...filters, search: e.target.value })}
          className="pl-10 border-stone-200 focus:border-stone-400 focus:ring-stone-400"
        />
      </div>

      <div className="flex gap-3">
        <Select
          value={filters.category}
          onValueChange={(value) => onFilterChange({ ...filters, category: value })}
        >
          <SelectTrigger className="w-40 border-stone-200">
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
          <SelectTrigger className="w-36 border-stone-200">
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
