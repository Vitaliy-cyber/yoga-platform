import React, { useState, useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  GripVertical,
  Trash2,
  Clock,
  Plus,
  Save,
  Edit3,
  X,
  Check,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Badge } from "../ui/badge";
import type { Sequence, SequencePose, PoseListItem } from "../../types";
import { useSequenceStore } from "../../store/useSequenceStore";
import { posesApi } from "../../services/api";
import { useI18n } from "../../i18n";
import { PoseImage } from "../Pose";

interface SequenceBuilderProps {
  sequence: Sequence;
  onSave?: () => void;
}

interface DraggableItemProps {
  pose: SequencePose;
  index: number;
  onDurationChange: (id: number, duration: number) => void;
  onNoteChange: (id: number, note: string) => void;
  onRemove: (id: number) => void;
  onDragStart: (index: number, poseId: number) => void;
  onDragOver: (index: number) => void;
  onDrop: (
    index: number,
    sourcePoseId: number | null,
    sourceIndex: number | null,
  ) => void;
  onDragEnd: () => void;
  onTouchStart: (index: number, e: React.TouchEvent) => void;
  onTouchMove: (e: React.TouchEvent) => void;
  onTouchEnd: () => void;
  isDragging: boolean;
  isOver: boolean;
}

const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
};

const DraggableItem: React.FC<DraggableItemProps> = ({
  pose,
  index,
  onDurationChange,
  onNoteChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  isDragging,
  isOver,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localDuration, setLocalDuration] = useState(pose.duration_seconds);
  const [localNote, setLocalNote] = useState(pose.transition_note || "");
  const { t } = useI18n();
  const dragHandleRef = useRef<HTMLDivElement>(null);

  const hasImage = pose.pose_photo_path || pose.pose_schema_path;
  const imageType = pose.pose_photo_path ? "photo" : "schema";

  const handleSave = () => {
    onDurationChange(pose.id, localDuration);
    onNoteChange(pose.id, localNote);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setLocalDuration(pose.duration_seconds);
    setLocalNote(pose.transition_note || "");
    setIsEditing(false);
  };

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        // Required for consistent DnD behavior in Firefox/Safari.
        e.dataTransfer.setData("text/plain", String(pose.id));
        e.dataTransfer.setData("text/x-sequence-index", String(index));
        onDragStart(index, pose.id);
      }}
      onDragEnter={() => onDragOver(index)}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOver(index);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const rawPoseId = e.dataTransfer.getData("text/plain");
        const sourcePoseId = Number.parseInt(rawPoseId, 10);
        if (!Number.isNaN(sourcePoseId)) {
          onDrop(index, sourcePoseId, null);
          return;
        }
        const fallbackIndex = Number.parseInt(
          e.dataTransfer.getData("text/x-sequence-index"),
          10,
        );
        onDrop(index, null, Number.isNaN(fallbackIndex) ? null : fallbackIndex);
      }}
      onDragEnd={onDragEnd}
      data-testid={`sequence-builder-item-${pose.id}`}
      className={`
        flex items-center gap-3 p-3 bg-card rounded-xl border transition-[transform,border-color,opacity,box-shadow,background-color] duration-200 ease-out
        ${isDragging ? "opacity-50 border-primary shadow-lg scale-[1.01] -translate-y-0.5" : "border-border"}
        ${isOver ? "border-primary border-dashed bg-primary/5" : ""}
        hover:shadow-md cursor-grab active:cursor-grabbing
        touch-manipulation select-none
      `}
    >
      {/* Drag handle - touch enabled */}
      <div
        ref={dragHandleRef}
        data-testid={`sequence-builder-drag-handle-${pose.id}`}
        className="text-muted-foreground/70 hover:text-muted-foreground cursor-grab p-1 -m-1 touch-manipulation transition-colors duration-150"
        onTouchStart={(e) => onTouchStart(index, e)}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="button"
        aria-label={t("sequences.drag_to_reorder")}
        tabIndex={0}
      >
        <GripVertical className="w-5 h-5" />
      </div>

      {/* Index */}
      <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-sm font-medium text-muted-foreground">
        {index + 1}
      </div>

      {/* Image */}
      <div className="w-16 h-12 rounded-lg bg-muted overflow-hidden flex-shrink-0">
        {hasImage ? (
          <PoseImage
            poseId={pose.pose_id}
            imageType={imageType}
            directPath={
              imageType === "photo"
                ? pose.pose_photo_path
                : pose.pose_schema_path
            }
            alt={pose.pose_name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-5 h-5 text-muted-foreground/70" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <h4 className="font-medium text-foreground truncate">
          {pose.pose_name}
        </h4>
        <p className="text-xs text-muted-foreground">#{pose.pose_code}</p>
      </div>

      {/* Duration & Note Edit */}
      <div className="flex items-center justify-end min-w-[220px]">
        <div className="relative h-8 w-full">
          <AnimatePresence initial={false} mode="popLayout">
            {isEditing ? (
              <motion.div
                key="editing"
                layout
                className="absolute inset-0 flex items-center justify-end gap-2"
                initial={{ opacity: 0, x: 8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <Input
                  type="number"
                  value={localDuration}
                  onChange={(e) =>
                    setLocalDuration(
                      Math.min(600, Math.max(5, parseInt(e.target.value) || 30)),
                    )
                  }
                  className="w-20 h-8 text-sm tabular-nums transition-[border-color,box-shadow] duration-150"
                  min={5}
                  max={600}
                  data-testid={`sequence-builder-duration-${pose.id}`}
                />
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {t("sequences.seconds")}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleSave}
                  className="h-8 w-8 rounded-md text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 transition-[transform,color,background-color,opacity] duration-150 ease-out active:scale-95"
                  aria-label={t("common.save")}
                  data-testid={`sequence-builder-edit-save-${pose.id}`}
                >
                  <Check className="w-4 h-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={handleCancel}
                  className="h-8 w-8 rounded-md text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-[transform,color,background-color,opacity] duration-150 ease-out active:scale-95"
                  aria-label={t("common.cancel")}
                  data-testid={`sequence-builder-edit-cancel-${pose.id}`}
                >
                  <X className="w-4 h-4" />
                </Button>
              </motion.div>
            ) : (
              <motion.div
                key="viewing"
                layout
                className="absolute inset-0 flex items-center justify-end gap-2"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              >
                <Badge variant="outline" className="gap-1 tabular-nums">
                  <Clock className="w-3 h-3" />
                  {formatDuration(pose.duration_seconds)}
                </Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => setIsEditing(true)}
                  className="h-8 w-8 rounded-md text-muted-foreground/70 hover:text-muted-foreground hover:bg-accent transition-[transform,color,background-color,opacity] duration-150 ease-out active:scale-95"
                  data-testid={`sequence-builder-edit-${pose.id}`}
                >
                  <Edit3 className="w-4 h-4" />
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* Remove */}
      <Button
        size="icon"
        variant="ghost"
        onClick={() => onRemove(pose.id)}
        className="h-8 w-8 rounded-md text-muted-foreground/70 hover:text-rose-500 hover:bg-rose-50 transition-[transform,color,background-color,opacity] duration-150 ease-out active:scale-95"
        aria-label={t("sequences.remove_pose")}
        data-testid={`sequence-builder-remove-${pose.id}`}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
};

// Pose Picker Dialog
// TODO: This custom modal should be refactored to use a proper Dialog component
// (e.g., Radix UI Dialog or Headless UI Dialog) for proper focus management.
// A Dialog component would provide:
// - Focus trapping within the modal
// - Return focus to trigger element on close
// - Escape key handling
// - Proper ARIA attributes (role="dialog", aria-modal="true", aria-labelledby)
interface PosePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (pose: PoseListItem) => void;
  existingPoseIds: number[];
}

const POSE_PICKER_CLOSE_ANIMATION_MS = 220;

const PosePicker: React.FC<PosePickerProps> = ({
  isOpen,
  onClose,
  onSelect,
  existingPoseIds,
}) => {
  const [poses, setPoses] = useState<PoseListItem[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isRendered, setIsRendered] = useState(isOpen);
  const [isClosing, setIsClosing] = useState(false);
  const { t } = useI18n();
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setIsRendered(true);
      setIsClosing(false);
      return;
    }

    if (!isRendered) return;

    setIsClosing(true);
    const timer = window.setTimeout(() => {
      setIsRendered(false);
      setIsClosing(false);
      setSearch("");
    }, POSE_PICKER_CLOSE_ANIMATION_MS);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isOpen, isRendered]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Auto-focus search input when modal opens
  useEffect(() => {
    if (isOpen && searchInputRef.current) {
      // Small delay to ensure modal is rendered
      const timer = setTimeout(() => {
        searchInputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const abortController = new AbortController();
      setIsLoading(true);
      setError(null);
      posesApi
        .getAll(undefined, 0, 200, abortController.signal)
        .then((data) => {
          if (!abortController.signal.aborted) {
            setPoses(data);
          }
        })
        .catch((err) => {
          if (!abortController.signal.aborted) {
            const errorMessage =
              err instanceof Error
                ? err.message
                : t("sequences.error_loading_poses");
            setError(errorMessage);
          }
        })
        .finally(() => {
          if (!abortController.signal.aborted) {
            setIsLoading(false);
          }
        });

      return () => {
        abortController.abort();
      };
    }
  }, [isOpen, t]);

  const filteredPoses = poses.filter(
    (p) =>
      !existingPoseIds.includes(p.id) &&
      (p.name.toLowerCase().includes(search.toLowerCase()) ||
        p.code.toLowerCase().includes(search.toLowerCase())),
  );

  if (!isRendered) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[1px] ${
        isClosing ? "animate-overlay-out pointer-events-none" : "animate-overlay-in"
      }`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pose-picker-title"
    >
      <div
        className={`bg-card rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col ${
          isClosing ? "animate-modal-out" : "animate-modal-in"
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h3
              id="pose-picker-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("sequences.add_pose")}
            </h3>
            <Button
              size="icon"
              variant="ghost"
              onClick={onClose}
              aria-label={t("common.close")}
            >
              <X className="w-5 h-5" />
            </Button>
          </div>
          <Input
            ref={searchInputRef}
            placeholder={t("sequences.search_poses")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
            aria-label={t("sequences.search_poses")}
            data-testid="sequence-pose-picker-search"
          />
        </div>

        {/* Poses list */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("app.loading")}
            </div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-rose-500 mb-2">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsLoading(true);
                  setError(null);
                  posesApi
                    .getAll(undefined, 0, 200)
                    .then(setPoses)
                    .catch((err) => {
                      const errorMessage =
                        err instanceof Error
                          ? err.message
                          : t("sequences.error_loading_poses");
                      setError(errorMessage);
                    })
                    .finally(() => setIsLoading(false));
                }}
              >
                {t("app.retry")}
              </Button>
            </div>
          ) : filteredPoses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t("sequences.no_poses_available")}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredPoses.map((pose, index) => (
                <button
                  key={pose.id}
                  onClick={() => {
                    onSelect(pose);
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary hover:bg-accent transition-[transform,border-color,background-color] duration-200 ease-out text-left animate-sequence-row-in hover:-translate-y-0.5"
                  style={{ animationDelay: `${Math.min(index * 24, 240)}ms` }}
                  data-testid={`sequence-pose-picker-option-${pose.id}`}
                >
                  <div className="w-12 h-12 rounded-lg bg-muted overflow-hidden flex-shrink-0">
                    {pose.photo_path || pose.schema_path ? (
                      <PoseImage
                        poseId={pose.id}
                        imageType={pose.photo_path ? "photo" : "schema"}
                        directPath={pose.photo_path || pose.schema_path}
                        alt={pose.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-5 h-5 text-muted-foreground/70" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium text-foreground truncate">
                      {pose.name}
                    </h4>
                    <p className="text-xs text-muted-foreground">
                      #{pose.code}
                    </p>
                  </div>
                  <Plus className="w-5 h-5 text-muted-foreground/70" />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const SequenceBuilder: React.FC<SequenceBuilderProps> = ({
  sequence,
  onSave,
}) => {
  const { t } = useI18n();
  const { addPose, updatePose, removePose, reorderPoses, isSaving } =
    useSequenceStore();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<
    Map<number, { duration?: number; note?: string }>
  >(new Map());
  const enteredPoseIdsRef = useRef<Set<number>>(new Set());
  const dragSourceIndexRef = useRef<number | null>(null);
  const dragSourcePoseIdRef = useRef<number | null>(null);
  const reorderInFlightRef = useRef(false);
  const dropHandledRef = useRef(false);

  // Touch drag state
  const touchStartY = useRef<number | null>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const handleDragStart = (index: number, poseId: number) => {
    dropHandledRef.current = false;
    dragSourceIndexRef.current = index;
    dragSourcePoseIdRef.current = poseId;
    setDraggedIndex(index);
  };

  const handleDragOver = (index: number) => {
    if (draggedIndex !== null && draggedIndex !== index && overIndex !== index) {
      setOverIndex(index);
    }
  };

  const commitReorder = useCallback(
    async (sourceIndex: number, targetIndex: number) => {
      if (sourceIndex === targetIndex) return;
      if (reorderInFlightRef.current) return;

      const newPoses = [...sequence.poses];
      if (
        sourceIndex < 0 ||
        sourceIndex >= newPoses.length ||
        targetIndex < 0 ||
        targetIndex >= newPoses.length
      ) {
        return;
      }
      const [dragged] = newPoses.splice(sourceIndex, 1);
      if (!dragged) return;
      newPoses.splice(targetIndex, 0, dragged);
      const poseIds = newPoses.map((p) => p.id);

      reorderInFlightRef.current = true;
      try {
        await reorderPoses(sequence.id, { pose_ids: poseIds });
      } finally {
        reorderInFlightRef.current = false;
      }
    },
    [reorderPoses, sequence.id, sequence.poses],
  );

  const handleDrop = useCallback(
    async (
      targetIndex: number,
      sourcePoseId: number | null,
      sourceIndexFromTransfer: number | null,
    ) => {
      if (dropHandledRef.current) return;
      dropHandledRef.current = true;
      const sourcePoseIdFromRef = dragSourcePoseIdRef.current;
      const sourcePoseIdResolved = sourcePoseId ?? sourcePoseIdFromRef;
      const sourceIndexFromId =
        sourcePoseIdResolved !== null
          ? sequence.poses.findIndex((p) => p.id === sourcePoseIdResolved)
          : -1;
      const sourceIndex =
        sourceIndexFromId >= 0
          ? sourceIndexFromId
          : sourceIndexFromTransfer ??
            dragSourceIndexRef.current ??
            draggedIndex;
      if (sourceIndex === null || sourceIndex < 0) return;

      setDraggedIndex(null);
      setOverIndex(null);
      dragSourceIndexRef.current = null;
      dragSourcePoseIdRef.current = null;
      await commitReorder(sourceIndex, targetIndex);
    },
    [commitReorder, draggedIndex, sequence.poses],
  );

  const handleListDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (overIndex === null) return;

      const rawPoseId = e.dataTransfer.getData("text/plain");
      const sourcePoseId = Number.parseInt(rawPoseId, 10);
      const sourceIndexRaw = e.dataTransfer.getData("text/x-sequence-index");
      const sourceIndex = Number.parseInt(sourceIndexRaw, 10);

      await handleDrop(
        overIndex,
        Number.isNaN(sourcePoseId) ? null : sourcePoseId,
        Number.isNaN(sourceIndex) ? null : sourceIndex,
      );
    },
    [handleDrop, overIndex],
  );

  const handleDragEnd = useCallback(() => {
    const sourceIndex =
      dragSourceIndexRef.current !== null
        ? dragSourceIndexRef.current
        : draggedIndex;
    const targetIndex = overIndex;
    const shouldCommitFallback =
      !dropHandledRef.current &&
      sourceIndex !== null &&
      targetIndex !== null &&
      sourceIndex !== targetIndex;

    dropHandledRef.current = false;
    setDraggedIndex(null);
    setOverIndex(null);
    dragSourceIndexRef.current = null;
    dragSourcePoseIdRef.current = null;
    if (shouldCommitFallback && sourceIndex !== null && targetIndex !== null) {
      void commitReorder(sourceIndex, targetIndex);
    }
  }, [commitReorder, draggedIndex, overIndex]);

  // Touch event handlers for mobile drag-drop
  const handleTouchStart = useCallback((index: number, e: React.TouchEvent) => {
    e.preventDefault();
    touchStartY.current = e.touches[0].clientY;
    setDraggedIndex(index);
  }, []);

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (draggedIndex === null || touchStartY.current === null) return;

      const currentY = e.touches[0].clientY;

      // Find which item we're currently over
      for (const [index, pose] of sequence.poses.entries()) {
        const element = itemRefs.current.get(pose.id);
        if (element) {
          const rect = element.getBoundingClientRect();
          if (
            currentY >= rect.top &&
            currentY <= rect.bottom &&
            index !== draggedIndex
          ) {
            if (overIndex !== index) {
              setOverIndex(index);
            }
            break;
          }
        }
      }
    },
    [draggedIndex, overIndex, sequence.poses],
  );

  const handleTouchEnd = useCallback(async () => {
    touchStartY.current = null;

    if (draggedIndex === null) {
      setOverIndex(null);
      return;
    }

    const sourceIndex = draggedIndex;
    const targetIndex = overIndex ?? draggedIndex;
    setDraggedIndex(null);
    setOverIndex(null);
    await commitReorder(sourceIndex, targetIndex);
  }, [commitReorder, draggedIndex, overIndex]);

  const handleDurationChange = (id: number, duration: number) => {
    setPendingChanges((prev) => {
      const existing = prev.get(id) || {};
      return new Map(prev).set(id, { ...existing, duration });
    });
  };

  const handleNoteChange = (id: number, note: string) => {
    setPendingChanges((prev) => {
      const existing = prev.get(id) || {};
      return new Map(prev).set(id, { ...existing, note });
    });
  };

  const handleRemove = async (sequencePoseId: number) => {
    await removePose(sequence.id, sequencePoseId);
  };

  const handleAddPose = async (pose: PoseListItem) => {
    await addPose(sequence.id, {
      pose_id: pose.id,
      duration_seconds: 30,
    });
  };

  const handleSaveChanges = async () => {
    // Save all pending changes
    for (const [id, changes] of pendingChanges.entries()) {
      const pose = sequence.poses.find((p) => p.id === id);
      if (pose) {
        await updatePose(sequence.id, id, {
          pose_id: pose.pose_id,
          duration_seconds: changes.duration ?? pose.duration_seconds,
          transition_note: changes.note ?? pose.transition_note ?? undefined,
        });
      }
    }
    setPendingChanges(new Map());
    onSave?.();
  };

  const totalDuration = sequence.poses.reduce((acc, p) => {
    const pending = pendingChanges.get(p.id);
    return acc + (pending?.duration ?? p.duration_seconds);
  }, 0);

  const existingPoseIds = sequence.poses.map((p) => p.pose_id);

  return (
    <div className="space-y-4" data-testid="sequence-builder">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            {t("sequences.poses_in_sequence")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {sequence.poses.length} {t("sequences.poses")} -{" "}
            {formatDuration(totalDuration)} {t("sequences.total")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowPicker(true)}
            data-testid="sequence-builder-add-pose"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t("sequences.add_pose")}
          </Button>
          {pendingChanges.size > 0 && (
            <Button
              onClick={handleSaveChanges}
              disabled={isSaving}
              data-testid="sequence-builder-save-changes"
            >
              <Save className="w-4 h-4 mr-2" />
              {t("sequences.save_changes")}
            </Button>
          )}
        </div>
      </div>

      {/* Poses list */}
      {sequence.poses.length === 0 ? (
        <div className="text-center py-12 bg-muted rounded-xl border-2 border-dashed border-border">
          <ImageIcon className="w-12 h-12 text-muted-foreground/70 mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">
            {t("sequences.no_poses_yet")}
          </p>
          <Button
            variant="outline"
            onClick={() => setShowPicker(true)}
            data-testid="sequence-builder-add-first-pose"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t("sequences.add_first_pose")}
          </Button>
        </div>
      ) : (
        <div
          className="space-y-2"
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
          }}
          onDrop={handleListDrop}
        >
          {sequence.poses.map((pose, index) => (
            <motion.div
              key={pose.id}
              layout
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
              className={
                enteredPoseIdsRef.current.has(pose.id)
                  ? ""
                  : "animate-sequence-row-in"
              }
              onAnimationEnd={() => {
                enteredPoseIdsRef.current.add(pose.id);
              }}
              ref={(el) => {
                if (el) {
                  itemRefs.current.set(pose.id, el as HTMLDivElement);
                } else {
                  itemRefs.current.delete(pose.id);
                }
              }}
            >
              <DraggableItem
                pose={pose}
                index={index}
                onDurationChange={handleDurationChange}
                onNoteChange={handleNoteChange}
                onRemove={handleRemove}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                isDragging={draggedIndex === index}
                isOver={overIndex === index}
              />
            </motion.div>
          ))}
        </div>
      )}

      {/* Pose Picker */}
      <PosePicker
        isOpen={showPicker}
        onClose={() => setShowPicker(false)}
        onSelect={handleAddPose}
        existingPoseIds={existingPoseIds}
      />
    </div>
  );
};
