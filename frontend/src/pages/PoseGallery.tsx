import React, { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import { PoseCard, PoseFilters, PoseViewer, GenerateModal } from "../components/Pose";
import { categoriesApi, posesApi, getImageProxyUrl } from "../services/api";
import { Button } from "../components/ui/button";
import { Grid3X3, List, Loader2, Image, Plus } from "lucide-react";
import type { Category, PoseListItem, Pose } from "../types";

export const PoseGallery: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryIdParam = searchParams.get("category");
  const categoryId = categoryIdParam ? parseInt(categoryIdParam, 10) : undefined;

  const [poses, setPoses] = useState<PoseListItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [filters, setFilters] = useState({
    search: "",
    category: categoryId ? String(categoryId) : "all",
    status: "all",
  });
  const [selectedPose, setSelectedPose] = useState<Pose | null>(null);
  const [generatePose, setGeneratePose] = useState<PoseListItem | null>(null);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const [posesData, categoriesData] = await Promise.all([
        posesApi.getAll(categoryId, 0, 200),
        categoriesApi.getAll(),
      ]);
      setPoses(posesData);
      setCategories(categoriesData);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [categoryId]);

  useEffect(() => {
    if (categoryId) {
      setFilters((prev) => ({ ...prev, category: String(categoryId) }));
    }
  }, [categoryId]);

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

  const handleCategoryFilter = (nextFilters: typeof filters) => {
    setFilters(nextFilters);
    if (nextFilters.category === "all") {
      setSearchParams({});
    } else {
      setSearchParams({ category: nextFilters.category });
    }
  };

  const handleViewPose = async (pose: PoseListItem) => {
    try {
      const fullPose = await posesApi.getById(pose.id);
      setSelectedPose(fullPose);
    } catch (error) {
      console.error("Failed to load pose:", error);
    }
  };

  return (
    <div className="min-h-screen bg-stone-50">
      <header className="bg-white border-b border-stone-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-stone-800">Pose Library</h1>
            <p className="text-stone-500 text-sm mt-0.5">
              {filteredPoses.length} poses • {categories.length} categories
            </p>
          </div>
          <Link to="/upload">
            <Button className="bg-stone-800 hover:bg-stone-900 text-white rounded-xl h-11 px-5">
              <Plus className="w-4 h-4 mr-2" />
              New Pose
            </Button>
          </Link>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <PoseFilters filters={filters} categories={categories} onFilterChange={handleCategoryFilter} />
        </div>

        <div className="flex items-center justify-between mb-6">
          <p className="text-stone-500 text-sm">
            Showing {filteredPoses.length} of {poses.length} poses
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
            <h3 className="text-lg font-medium text-stone-800 mb-2">No poses found</h3>
            <p className="text-stone-500 mb-6">Try adjusting your filters</p>
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
                  <p className="text-stone-500 text-sm">#{pose.code} • {pose.category_name || "Uncategorized"}</p>
                </div>
                <Button variant="outline" onClick={() => handleViewPose(pose)}>
                  View
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
