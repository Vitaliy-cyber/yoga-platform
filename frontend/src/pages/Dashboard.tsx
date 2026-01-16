import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { PoseCard, PoseFilters, PoseViewer, GenerateModal } from "../components/Pose";
import { categoriesApi, posesApi, getImageProxyUrl } from "../services/api";
import { Plus, Grid3X3, List, Image, Loader2, Globe } from "lucide-react";
import type { Category, PoseListItem, Pose } from "../types";
import { useI18n } from "../i18n";

export const Dashboard: React.FC = () => {
  const [poses, setPoses] = useState<PoseListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { t, locale, setLocale } = useI18n();
  const [filters, setFilters] = useState({
    search: "",
    category: "all",
    status: "all",
  });
  const [selectedPose, setSelectedPose] = useState<Pose | null>(null);
  const [generatePose, setGeneratePose] = useState<PoseListItem | null>(null);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [posesData, categoriesData] = await Promise.all([
        posesApi.getAll(undefined, 0, 100),
        categoriesApi.getAll(),
      ]);
      setPoses(posesData);
      setCategories(categoriesData);
    } catch (error) {
      console.error(t("dashboard.fetch_failed"), error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const poseStatus = (pose: PoseListItem) => (pose.photo_path ? "complete" : "draft");

  const filteredPoses = useMemo(() => {
    return poses.filter((pose) => {
      const matchesSearch =
        !filters.search ||
        pose.name.toLowerCase().includes(filters.search.toLowerCase()) ||
        pose.name_en?.toLowerCase().includes(filters.search.toLowerCase());

      const matchesCategory =
        filters.category === "all" ||
        String(pose.category_id || "") === filters.category;

      const matchesStatus =
        filters.status === "all" || poseStatus(pose) === filters.status;

      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [poses, filters]);

  const stats = {
    total: poses.length,
    complete: poses.filter((pose) => pose.photo_path).length,
    draft: poses.filter((pose) => !pose.photo_path).length,
    processing: 0,
  };

  const handleViewPose = async (pose: PoseListItem) => {
    try {
      const fullPose = await posesApi.getById(pose.id);
      setSelectedPose(fullPose);
    } catch (error) {
      console.error(t("pose.load_failed"), error);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-stone-800">{t("app.name")}</h1>
              <p className="text-stone-500 text-sm mt-0.5">
                {t("app.tagline")}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setLocale(locale === "ua" ? "en" : "ua")}
                className="flex items-center gap-2 px-3 py-2 text-sm text-stone-600 hover:text-stone-800 hover:bg-stone-100 rounded-lg transition-colors"
                title={t("app.language_toggle")}
              >
                <Globe className="w-4 h-4" />
                <span className="font-medium">{locale === "ua" ? "UA" : "EN"}</span>
              </button>
              <Link to="/upload">
                <Button className="bg-stone-800 hover:bg-stone-900 text-white rounded-xl h-11 px-5">
                  <Plus className="w-4 h-4 mr-2" />
                  {t("dashboard.new_pose")}
                </Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: t("dashboard.total"), value: stats.total, color: "bg-stone-100 text-stone-700" },
            { label: t("dashboard.complete"), value: stats.complete, color: "bg-emerald-50 text-emerald-700" },
            { label: t("dashboard.drafts"), value: stats.draft, color: "bg-amber-50 text-amber-700" },
            { label: t("dashboard.processing"), value: stats.processing, color: "bg-blue-50 text-blue-700" },
          ].map((stat, idx) => (
            <div
              key={stat.label}
              className={`${stat.color} rounded-2xl p-5 animate-fade-in`}
              style={{ animationDelay: `${idx * 50}ms` }}
            >
              <p className="text-3xl font-semibold">{stat.value}</p>
              <p className="text-sm opacity-80 mt-1">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="mb-6">
          <PoseFilters
            filters={filters}
            categories={categories}
            onFilterChange={setFilters}
          />
        </div>

        <div className="flex items-center justify-between mb-6">
          <p className="text-stone-500 text-sm">
            {t("dashboard.showing", { shown: filteredPoses.length, total: poses.length })}
          </p>
          <div className="flex items-center gap-2 bg-white rounded-lg border border-stone-200 p-1">
            <button
              onClick={() => setViewMode("grid")}
              className={`p-2 rounded-md transition-colors ${
                viewMode === "grid" ? "bg-stone-100 text-stone-800" : "text-stone-400 hover:text-stone-600"
              }`}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode("list")}
              className={`p-2 rounded-md transition-colors ${
                viewMode === "list" ? "bg-stone-100 text-stone-800" : "text-stone-400 hover:text-stone-600"
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-stone-400 animate-spin" />
          </div>
        ) : filteredPoses.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
              <Image className="w-10 h-10 text-stone-400" />
            </div>
            <h3 className="text-lg font-medium text-stone-800 mb-2">{t("dashboard.no_poses")}</h3>
            <p className="text-stone-500 mb-6">
              {poses.length === 0 ? t("dashboard.no_poses_hint") : t("dashboard.adjust_filters")}
            </p>
            {poses.length === 0 && (
              <Link to="/upload">
                <Button className="bg-stone-800 hover:bg-stone-900">
                  <Plus className="w-4 h-4 mr-2" />
                  {t("dashboard.create_first")}
                </Button>
              </Link>
            )}
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {filteredPoses.map((pose) => (
              <PoseCard
                key={pose.id}
                pose={pose}
                onView={handleViewPose}
                onGenerate={() => setGeneratePose(pose)}
              />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredPoses.map((pose) => (
              <div
                key={pose.id}
                className="flex items-center gap-4 p-4 rounded-xl border bg-white hover:bg-stone-50 transition-colors"
              >
                <img
                  src={pose.photo_path ? getImageProxyUrl(pose.id, 'photo') : pose.schema_path ? getImageProxyUrl(pose.id, 'schema') : "/placeholder.jpg"}
                  alt={pose.name}
                  className="w-16 h-16 rounded-lg object-cover bg-stone-100"
                />
                <div className="flex-1">
                  <h3 className="font-semibold text-lg text-stone-800">{pose.name}</h3>
                  <p className="text-stone-500 text-sm">#{pose.code} • {pose.category_name || t("pose.uncategorized")}</p>
                </div>
                <Button variant="outline" onClick={() => handleViewPose(pose)}>
                  {t("pose.view")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </main>

      {selectedPose && (
        <PoseViewer pose={selectedPose} isOpen={!!selectedPose} onClose={() => setSelectedPose(null)} />
      )}

      {generatePose && (
        <GenerateModal
          pose={generatePose}
          isOpen={!!generatePose}
          onClose={() => setGeneratePose(null)}
          onComplete={fetchData}
        />
      )}
    </div>
  );
};
