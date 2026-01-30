import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
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
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Badge } from '../ui/badge';
import type { Sequence, SequencePose, PoseListItem } from '../../types';
import { useSequenceStore } from '../../store/useSequenceStore';
import { posesApi } from '../../services/api';
import { useI18n } from '../../i18n';
import { PoseImage } from '../Pose';

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
  onDragStart: (index: number) => void;
  onDragOver: (index: number) => void;
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
  onDragEnd,
  onTouchStart,
  onTouchMove,
  onTouchEnd,
  isDragging,
  isOver,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [localDuration, setLocalDuration] = useState(pose.duration_seconds);
  const [localNote, setLocalNote] = useState(pose.transition_note || '');
  const { t } = useI18n();
  const dragHandleRef = useRef<HTMLDivElement>(null);

  const hasImage = pose.pose_photo_path || pose.pose_schema_path;
  const imageType = pose.pose_photo_path ? 'photo' : 'schema';

  const handleSave = () => {
    onDurationChange(pose.id, localDuration);
    onNoteChange(pose.id, localNote);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setLocalDuration(pose.duration_seconds);
    setLocalNote(pose.transition_note || '');
    setIsEditing(false);
  };

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(index);
      }}
      onDragEnd={onDragEnd}
      className={`
        flex items-center gap-3 p-3 bg-card rounded-xl border transition-all
        ${isDragging ? 'opacity-50 border-primary shadow-lg scale-105' : 'border-border'}
        ${isOver ? 'border-primary border-dashed bg-primary/5' : ''}
        hover:shadow-md cursor-grab active:cursor-grabbing
        touch-manipulation select-none
      `}
    >
      {/* Drag handle - touch enabled */}
      <div
        ref={dragHandleRef}
        className="text-muted-foreground/70 hover:text-muted-foreground cursor-grab p-1 -m-1 touch-manipulation"
        onTouchStart={(e) => onTouchStart(index, e)}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        role="button"
        aria-label={t('sequences.drag_to_reorder')}
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
            directPath={imageType === "photo" ? pose.pose_photo_path : pose.pose_schema_path}
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
        <h4 className="font-medium text-foreground truncate">{pose.pose_name}</h4>
        <p className="text-xs text-muted-foreground">#{pose.pose_code}</p>
      </div>

      {/* Duration & Note Edit */}
      <AnimatePresence mode="wait">
        {isEditing ? (
          <motion.div
            key="editing"
            className="flex items-center gap-2"
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -10 }}
            transition={{ duration: 0.15 }}
          >
            <Input
              type="number"
              value={localDuration}
              onChange={(e) => setLocalDuration(Math.min(600, Math.max(5, parseInt(e.target.value) || 30)))}
              className="w-20 h-8 text-sm"
              min={5}
              max={600}
            />
            <span className="text-xs text-muted-foreground">{t('sequences.seconds')}</span>
            <Button size="icon" variant="ghost" onClick={handleSave} className="h-8 w-8 text-emerald-600" aria-label={t('common.save')}>
              <Check className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" onClick={handleCancel} className="h-8 w-8 text-muted-foreground/70" aria-label={t('common.cancel')}>
              <X className="w-4 h-4" />
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key="viewing"
            className="flex items-center gap-2"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 10 }}
            transition={{ duration: 0.15 }}
          >
            <Badge variant="outline" className="gap-1">
              <Clock className="w-3 h-3" />
              {formatDuration(pose.duration_seconds)}
            </Badge>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => setIsEditing(true)}
              className="h-8 w-8 text-muted-foreground/70 hover:text-muted-foreground"
            >
              <Edit3 className="w-4 h-4" />
            </Button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Remove */}
      <Button
        size="icon"
        variant="ghost"
        onClick={() => onRemove(pose.id)}
        className="h-8 w-8 text-muted-foreground/70 hover:text-rose-500"
        aria-label={t('sequences.remove_pose')}
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

const PosePicker: React.FC<PosePickerProps> = ({ isOpen, onClose, onSelect, existingPoseIds }) => {
  const [poses, setPoses] = useState<PoseListItem[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useI18n();
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
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
      posesApi.getAll(undefined, 0, 200, abortController.signal)
        .then((data) => {
          if (!abortController.signal.aborted) {
            setPoses(data);
          }
        })
        .catch((err) => {
          if (!abortController.signal.aborted) {
            const errorMessage = err instanceof Error ? err.message : t('sequences.error_loading_poses');
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
        p.code.toLowerCase().includes(search.toLowerCase()))
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pose-picker-title"
    >
      <div
        className="bg-card rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-border">
          <div className="flex items-center justify-between mb-3">
            <h3 id="pose-picker-title" className="text-lg font-semibold text-foreground">{t('sequences.add_pose')}</h3>
            <Button size="icon" variant="ghost" onClick={onClose} aria-label={t('common.close')}>
              <X className="w-5 h-5" />
            </Button>
          </div>
          <Input
            ref={searchInputRef}
            placeholder={t('sequences.search_poses')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
            aria-label={t('sequences.search_poses')}
          />
        </div>

        {/* Poses list */}
        <div className="flex-1 overflow-y-auto p-4">
          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">{t('app.loading')}</div>
          ) : error ? (
            <div className="text-center py-8">
              <p className="text-rose-500 mb-2">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setIsLoading(true);
                  setError(null);
                  posesApi.getAll(undefined, 0, 200)
                    .then(setPoses)
                    .catch((err) => {
                      const errorMessage = err instanceof Error ? err.message : t('sequences.error_loading_poses');
                      setError(errorMessage);
                    })
                    .finally(() => setIsLoading(false));
                }}
              >
                {t('app.retry')}
              </Button>
            </div>
          ) : filteredPoses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">{t('sequences.no_poses_available')}</div>
          ) : (
            <div className="space-y-2">
              {filteredPoses.map((pose) => (
                <button
                  key={pose.id}
                  onClick={() => {
                    onSelect(pose);
                    onClose();
                  }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:border-primary hover:bg-accent transition-colors text-left"
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
                    <h4 className="font-medium text-foreground truncate">{pose.name}</h4>
                    <p className="text-xs text-muted-foreground">#{pose.code}</p>
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

export const SequenceBuilder: React.FC<SequenceBuilderProps> = ({ sequence, onSave }) => {
  const { t } = useI18n();
  const { addPose, updatePose, removePose, reorderPoses, isSaving } = useSequenceStore();

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [pendingChanges, setPendingChanges] = useState<Map<number, { duration?: number; note?: string }>>(new Map());

  // Touch drag state
  const touchStartY = useRef<number | null>(null);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (index: number) => {
    if (draggedIndex !== null && draggedIndex !== index) {
      setOverIndex(index);
    }
  };

  const handleDragEnd = useCallback(async () => {
    // Get fresh state from store to avoid stale closure issues
    const currentState = useSequenceStore.getState();
    const currentSequence = currentState.currentSequence;

    if (draggedIndex !== null && overIndex !== null && draggedIndex !== overIndex && currentSequence) {
      const newPoses = [...currentSequence.poses];
      const [dragged] = newPoses.splice(draggedIndex, 1);
      newPoses.splice(overIndex, 0, dragged);

      // Get new order of IDs
      const poseIds = newPoses.map((p) => p.id);
      await reorderPoses(currentSequence.id, { pose_ids: poseIds });
    }
    setDraggedIndex(null);
    setOverIndex(null);
  }, [draggedIndex, overIndex, reorderPoses]);

  // Touch event handlers for mobile drag-drop
  const handleTouchStart = useCallback((index: number, e: React.TouchEvent) => {
    e.preventDefault();
    touchStartY.current = e.touches[0].clientY;
    setDraggedIndex(index);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (draggedIndex === null || touchStartY.current === null) return;

    const currentY = e.touches[0].clientY;

    // Find which item we're currently over
    for (const [index, element] of itemRefs.current.entries()) {
      if (element) {
        const rect = element.getBoundingClientRect();
        if (currentY >= rect.top && currentY <= rect.bottom && index !== draggedIndex) {
          setOverIndex(index);
          break;
        }
      }
    }
  }, [draggedIndex]);

  const handleTouchEnd = useCallback(async () => {
    touchStartY.current = null;
    await handleDragEnd();
  }, [handleDragEnd]);

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
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">{t('sequences.poses_in_sequence')}</h3>
          <p className="text-sm text-muted-foreground">
            {sequence.poses.length} {t('sequences.poses')} - {formatDuration(totalDuration)} {t('sequences.total')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowPicker(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t('sequences.add_pose')}
          </Button>
          {pendingChanges.size > 0 && (
            <Button onClick={handleSaveChanges} disabled={isSaving}>
              <Save className="w-4 h-4 mr-2" />
              {t('sequences.save_changes')}
            </Button>
          )}
        </div>
      </div>

      {/* Poses list */}
      {sequence.poses.length === 0 ? (
        <div className="text-center py-12 bg-muted rounded-xl border-2 border-dashed border-border">
          <ImageIcon className="w-12 h-12 text-muted-foreground/70 mx-auto mb-3" />
          <p className="text-muted-foreground mb-4">{t('sequences.no_poses_yet')}</p>
          <Button variant="outline" onClick={() => setShowPicker(true)}>
            <Plus className="w-4 h-4 mr-2" />
            {t('sequences.add_first_pose')}
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {sequence.poses.map((pose, index) => (
            <div
              key={pose.id}
              ref={(el) => {
                if (el) itemRefs.current.set(index, el);
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
                onDragEnd={handleDragEnd}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                isDragging={draggedIndex === index}
                isOver={overIndex === index}
              />
            </div>
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
