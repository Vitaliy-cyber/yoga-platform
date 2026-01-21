import { create } from 'zustand';
import type {
  Sequence,
  SequenceListItem,
  SequenceCreate,
  SequenceUpdate,
  SequencePoseCreate,
  ReorderPosesRequest,
} from '../types';
import { sequencesApi } from '../services/api';

// AbortController for tracking fetchSequences requests to handle race conditions
let fetchSequencesAbortController: AbortController | null = null;

interface SequenceState {
  // Data
  sequences: SequenceListItem[];
  currentSequence: Sequence | null;
  total: number;

  // Pagination
  skip: number;
  limit: number;

  // Loading states
  isLoading: boolean;
  isLoadingSequence: boolean;
  isSaving: boolean;

  // Error state
  error: string | null;

  // Player state
  isPlaying: boolean;
  currentPoseIndex: number;
  remainingTime: number;

  // Actions
  fetchSequences: () => Promise<void>;
  fetchSequence: (id: number) => Promise<void>;
  createSequence: (data: SequenceCreate) => Promise<Sequence>;
  updateSequence: (id: number, data: SequenceUpdate) => Promise<Sequence>;
  deleteSequence: (id: number) => Promise<void>;
  addPose: (sequenceId: number, poseData: SequencePoseCreate) => Promise<void>;
  updatePose: (sequenceId: number, sequencePoseId: number, poseData: SequencePoseCreate) => Promise<void>;
  removePose: (sequenceId: number, sequencePoseId: number) => Promise<void>;
  reorderPoses: (sequenceId: number, data: ReorderPosesRequest) => Promise<void>;

  // Pagination actions
  setPage: (skip: number) => void;
  setLimit: (limit: number) => void;

  // Player actions
  startPlayer: () => void;
  pausePlayer: () => void;
  stopPlayer: () => void;
  nextPose: () => void;
  prevPose: () => void;
  setCurrentPoseIndex: (index: number) => void;
  updateRemainingTime: (time: number) => void;
  decrementRemainingTime: () => boolean; // Returns true if should move to next pose

  // Reset
  reset: () => void;
  clearError: () => void;
}

const initialState = {
  sequences: [],
  currentSequence: null,
  total: 0,
  skip: 0,
  limit: 20,
  isLoading: false,
  isLoadingSequence: false,
  isSaving: false,
  error: null,
  isPlaying: false,
  currentPoseIndex: 0,
  remainingTime: 0,
};

export const useSequenceStore = create<SequenceState>((set, get) => ({
  ...initialState,

  fetchSequences: async () => {
    const { skip, limit } = get();

    // Cancel any previous pending request to prevent race conditions
    if (fetchSequencesAbortController) {
      fetchSequencesAbortController.abort();
    }

    // Create new AbortController for this request
    const abortController = new AbortController();
    fetchSequencesAbortController = abortController;

    set({ isLoading: true, error: null });
    try {
      const response = await sequencesApi.getAll(skip, limit);

      // Only update state if this request wasn't aborted
      if (!abortController.signal.aborted) {
        set({
          sequences: response.items,
          total: response.total,
          isLoading: false,
        });
      }
    } catch (error) {
      // Ignore abort errors - they're expected when cancelling
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      // Only update state if this request wasn't aborted
      if (!abortController.signal.aborted) {
        set({
          error: error instanceof Error ? error.message : 'Failed to fetch sequences',
          isLoading: false,
        });
      }
    } finally {
      // Clean up if this was the active controller
      if (fetchSequencesAbortController === abortController) {
        fetchSequencesAbortController = null;
      }
    }
  },

  fetchSequence: async (id: number) => {
    set({ isLoadingSequence: true, error: null });
    try {
      const sequence = await sequencesApi.getById(id);
      set({
        currentSequence: sequence,
        isLoadingSequence: false,
        // Reset player state when loading new sequence
        currentPoseIndex: 0,
        remainingTime: sequence.poses[0]?.duration_seconds || 0,
        isPlaying: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch sequence',
        isLoadingSequence: false,
      });
    }
  },

  createSequence: async (data: SequenceCreate) => {
    set({ isSaving: true, error: null });
    try {
      const sequence = await sequencesApi.create(data);
      set({ isSaving: false });
      // Refresh list
      await get().fetchSequences();
      return sequence;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to create sequence',
        isSaving: false,
      });
      throw error;
    }
  },

  updateSequence: async (id: number, data: SequenceUpdate) => {
    set({ isSaving: true, error: null });
    try {
      const sequence = await sequencesApi.update(id, data);
      set({
        currentSequence: sequence,
        isSaving: false,
      });
      // Update in list if present
      set((state) => ({
        sequences: state.sequences.map((s) =>
          s.id === id
            ? {
                ...s,
                name: sequence.name,
                description: sequence.description,
                difficulty: sequence.difficulty,
              }
            : s
        ),
      }));
      return sequence;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update sequence',
        isSaving: false,
      });
      throw error;
    }
  },

  deleteSequence: async (id: number) => {
    set({ isSaving: true, error: null });
    try {
      await sequencesApi.delete(id);
      set((state) => ({
        sequences: state.sequences.filter((s) => s.id !== id),
        total: state.total - 1,
        currentSequence: state.currentSequence?.id === id ? null : state.currentSequence,
        isSaving: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to delete sequence',
        isSaving: false,
      });
      throw error;
    }
  },

  addPose: async (sequenceId: number, poseData: SequencePoseCreate) => {
    set({ isSaving: true, error: null });
    try {
      const sequence = await sequencesApi.addPose(sequenceId, poseData);
      // Atomic update: update both currentSequence and sequences list in a single set call
      set((state) => ({
        currentSequence: sequence,
        isSaving: false,
        sequences: state.sequences.map((s) =>
          s.id === sequenceId ? { ...s, pose_count: sequence.poses.length } : s
        ),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to add pose',
        isSaving: false,
      });
      throw error;
    }
  },

  updatePose: async (sequenceId: number, sequencePoseId: number, poseData: SequencePoseCreate) => {
    set({ isSaving: true, error: null });
    try {
      const sequence = await sequencesApi.updatePose(sequenceId, sequencePoseId, poseData);
      set({
        currentSequence: sequence,
        isSaving: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to update pose',
        isSaving: false,
      });
      throw error;
    }
  },

  removePose: async (sequenceId: number, sequencePoseId: number) => {
    set({ isSaving: true, error: null });
    try {
      const sequence = await sequencesApi.removePose(sequenceId, sequencePoseId);
      // Atomic update: update both currentSequence and sequences list in a single set call
      set((state) => ({
        currentSequence: sequence,
        isSaving: false,
        sequences: state.sequences.map((s) =>
          s.id === sequenceId ? { ...s, pose_count: sequence.poses.length } : s
        ),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to remove pose',
        isSaving: false,
      });
      throw error;
    }
  },

  reorderPoses: async (sequenceId: number, data: ReorderPosesRequest) => {
    set({ isSaving: true, error: null });
    try {
      const sequence = await sequencesApi.reorderPoses(sequenceId, data);
      set({
        currentSequence: sequence,
        isSaving: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to reorder poses',
        isSaving: false,
      });
      throw error;
    }
  },

  setPage: (skip: number) => {
    set({ skip });
    get().fetchSequences();
  },

  setLimit: (limit: number) => {
    set({ limit, skip: 0 });
    get().fetchSequences();
  },

  // Player actions
  startPlayer: () => {
    const { currentSequence, currentPoseIndex } = get();
    if (!currentSequence || currentSequence.poses.length === 0) return;

    const currentPose = currentSequence.poses[currentPoseIndex];
    set({
      isPlaying: true,
      remainingTime: currentPose?.duration_seconds || 30,
    });
  },

  pausePlayer: () => {
    set({ isPlaying: false });
  },

  stopPlayer: () => {
    const { currentSequence } = get();
    set({
      isPlaying: false,
      currentPoseIndex: 0,
      remainingTime: currentSequence?.poses[0]?.duration_seconds || 0,
    });
  },

  nextPose: () => {
    const { currentSequence, currentPoseIndex } = get();
    if (!currentSequence) return;

    const nextIndex = currentPoseIndex + 1;
    if (nextIndex < currentSequence.poses.length) {
      const nextPose = currentSequence.poses[nextIndex];
      set({
        currentPoseIndex: nextIndex,
        remainingTime: nextPose.duration_seconds,
      });
    } else {
      // End of sequence
      set({
        isPlaying: false,
        currentPoseIndex: 0,
        remainingTime: currentSequence.poses[0]?.duration_seconds || 0,
      });
    }
  },

  prevPose: () => {
    const { currentSequence, currentPoseIndex } = get();
    if (!currentSequence) return;

    const prevIndex = Math.max(0, currentPoseIndex - 1);
    const prevPose = currentSequence.poses[prevIndex];
    set({
      currentPoseIndex: prevIndex,
      remainingTime: prevPose?.duration_seconds || 30,
    });
  },

  setCurrentPoseIndex: (index: number) => {
    const { currentSequence } = get();
    if (!currentSequence || index < 0 || index >= currentSequence.poses.length) return;

    const pose = currentSequence.poses[index];
    set({
      currentPoseIndex: index,
      remainingTime: pose.duration_seconds,
    });
  },

  updateRemainingTime: (time: number) => {
    set({ remainingTime: time });
  },

  decrementRemainingTime: () => {
    // Use functional update to avoid stale closure issues
    // Returns true if remaining time reached 0 (should move to next pose)
    let shouldMoveNext = false;
    set((state) => {
      const newTime = state.remainingTime - 1;
      if (newTime <= 0) {
        shouldMoveNext = true;
        return state; // Don't update here, let nextPose handle it
      }
      return { remainingTime: newTime };
    });
    return shouldMoveNext;
  },

  reset: () => {
    set(initialState);
  },

  clearError: () => {
    set({ error: null });
  },
}));
