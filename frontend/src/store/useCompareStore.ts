import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ComparisonResult, PoseListItem } from '../types';
import { compareApi } from '../services/api';

const MAX_POSES_FOR_COMPARISON = 4;

interface CompareStore {
  // State
  selectedPoses: number[];
  selectedPoseData: Record<number, PoseListItem>;
  comparisonData: ComparisonResult | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  addPose: (id: number, poseData?: PoseListItem) => void;
  removePose: (id: number) => void;
  clearAll: () => void;
  togglePose: (id: number, poseData?: PoseListItem) => void;
  isPoseSelected: (id: number) => boolean;
  canAddMore: () => boolean;
  canCompare: () => boolean;
  compare: () => Promise<void>;
  clearComparison: () => void;
  getPoseData: (id: number) => PoseListItem | undefined;
}

export const useCompareStore = create<CompareStore>()(
  persist(
    (set, get) => ({
      // Initial state
      selectedPoses: [],
      selectedPoseData: {},
      comparisonData: null,
      isLoading: false,
      error: null,

      // Add a pose to comparison list
      addPose: (id: number, poseData?: PoseListItem) => {
        const { selectedPoses, selectedPoseData } = get();

        // Check if already at max or pose already added
        if (selectedPoses.length >= MAX_POSES_FOR_COMPARISON) {
          return;
        }
        if (selectedPoses.includes(id)) {
          return;
        }

        const newPoseData = { ...selectedPoseData };
        if (poseData) {
          newPoseData[id] = poseData;
        }

        set({
          selectedPoses: [...selectedPoses, id],
          selectedPoseData: newPoseData,
          // Clear previous comparison when selection changes
          comparisonData: null,
          error: null,
        });
      },

      // Remove a pose from comparison list
      removePose: (id: number) => {
        const { selectedPoses, selectedPoseData } = get();

        const newPoseData = { ...selectedPoseData };
        delete newPoseData[id];

        set({
          selectedPoses: selectedPoses.filter((poseId) => poseId !== id),
          selectedPoseData: newPoseData,
          // Clear previous comparison when selection changes
          comparisonData: null,
          error: null,
        });
      },

      // Clear all selected poses
      clearAll: () => {
        set({
          selectedPoses: [],
          selectedPoseData: {},
          comparisonData: null,
          error: null,
        });
      },

      // Toggle pose selection
      togglePose: (id: number, poseData?: PoseListItem) => {
        const { selectedPoses, addPose, removePose } = get();

        if (selectedPoses.includes(id)) {
          removePose(id);
        } else {
          addPose(id, poseData);
        }
      },

      // Check if a pose is selected
      isPoseSelected: (id: number) => {
        return get().selectedPoses.includes(id);
      },

      // Check if more poses can be added
      canAddMore: () => {
        return get().selectedPoses.length < MAX_POSES_FOR_COMPARISON;
      },

      // Check if comparison can be performed (at least 2 poses)
      canCompare: () => {
        return get().selectedPoses.length >= 2;
      },

      // Perform comparison
      compare: async () => {
        const { selectedPoses, canCompare } = get();

        if (!canCompare()) {
          set({ error: 'At least 2 poses are required for comparison' });
          return;
        }

        set({ isLoading: true, error: null });

        try {
          const result = await compareApi.poses(selectedPoses);
          set({ comparisonData: result, isLoading: false });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : 'Comparison failed';
          set({ error: errorMessage, isLoading: false });
        }
      },

      // Clear only the comparison result (keep selected poses)
      clearComparison: () => {
        set({ comparisonData: null, error: null });
      },

      // Get pose data by ID
      getPoseData: (id: number) => {
        return get().selectedPoseData[id];
      },
    }),
    {
      name: 'yoga-compare-storage',
      // Persist selectedPoses and selectedPoseData (Record is JSON-serializable)
      // Note: selectedPoseData may become stale if pose data changes on the server
      // It's primarily used for displaying thumbnails/names in the CompareBar
      partialize: (state) => ({
        selectedPoses: state.selectedPoses,
        selectedPoseData: state.selectedPoseData,
      }),
    }
  )
);

// Selector hooks for better performance
export const useSelectedPoseIds = () => useCompareStore((state) => state.selectedPoses);
export const useSelectedPoseCount = () => useCompareStore((state) => state.selectedPoses.length);
export const useCanCompare = () => useCompareStore((state) => state.selectedPoses.length >= 2);
export const useCanAddMore = () => useCompareStore((state) => state.selectedPoses.length < MAX_POSES_FOR_COMPARISON);
