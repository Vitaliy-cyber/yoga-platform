import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  Edit3,
  Trash2,
  Play,
  Settings,
  Loader2,
  Save,
  X,
  GraduationCap,
  Layers,
  Clock,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { SequenceBuilder, SequencePlayer } from '../components/Sequence';
import { useSequenceStore } from '../store/useSequenceStore';
import { useI18n } from '../i18n';
import type { DifficultyLevel } from '../types';

const difficultyColors: Record<DifficultyLevel, string> = {
  beginner: 'bg-emerald-100 text-emerald-700',
  intermediate: 'bg-amber-100 text-amber-700',
  advanced: 'bg-rose-100 text-rose-700',
};

const formatDuration = (seconds: number | null): string => {
  if (!seconds) return '--:--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const SequenceDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useI18n();

  const {
    currentSequence,
    isLoadingSequence,
    isSaving,
    error,
    fetchSequence,
    updateSequence,
    deleteSequence,
    clearError,
  } = useSequenceStore();

  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDifficulty, setEditDifficulty] = useState<DifficultyLevel>('beginner');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<'player' | 'builder'>('builder');

  useEffect(() => {
    if (id) {
      fetchSequence(parseInt(id, 10));
    }
    return () => clearError();
  }, [id, fetchSequence, clearError]);

  useEffect(() => {
    if (currentSequence) {
      setEditName(currentSequence.name);
      setEditDescription(currentSequence.description || '');
      setEditDifficulty(currentSequence.difficulty);
    }
  }, [currentSequence]);

  const handleSaveEdit = async () => {
    if (!currentSequence || !editName.trim()) return;

    await updateSequence(currentSequence.id, {
      name: editName.trim(),
      description: editDescription.trim() || undefined,
      difficulty: editDifficulty,
    });
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    if (currentSequence) {
      setEditName(currentSequence.name);
      setEditDescription(currentSequence.description || '');
      setEditDifficulty(currentSequence.difficulty);
    }
    setIsEditing(false);
  };

  const handleDelete = async () => {
    if (!currentSequence) return;
    try {
      await deleteSequence(currentSequence.id);
      navigate('/sequences');
    } catch (err) {
      // Error is handled by the store and displayed via the error banner
      console.error('Failed to delete sequence:', err);
    }
  };

  if (isLoadingSequence) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-muted-foreground animate-spin" />
      </div>
    );
  }

  if (!currentSequence) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center">
        <Layers className="w-16 h-16 text-muted-foreground/50 mb-4" />
        <h2 className="text-xl font-semibold text-foreground mb-2">{t('sequences.not_found')}</h2>
        <Link to="/sequences">
          <Button variant="outline">{t('sequences.back_to_list')}</Button>
        </Link>
      </div>
    );
  }

  const totalDuration = currentSequence.poses.reduce((acc, p) => acc + p.duration_seconds, 0);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-40">
        <div className="max-w-6xl mx-auto px-6 py-4">
          <Link
            to="/sequences"
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            {t('sequences.back_to_list')}
          </Link>

          <div className="flex items-start justify-between">
            <div className="flex-1">
              {isEditing ? (
                <div className="space-y-4">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="text-2xl font-semibold h-auto py-1"
                    placeholder={t('sequences.name')}
                  />
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    className="w-full h-20 px-3 py-2 rounded-lg border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary resize-none text-sm"
                    placeholder={t('sequences.description_placeholder')}
                  />
                  <Select
                    value={editDifficulty}
                    onValueChange={(v) => setEditDifficulty(v as DifficultyLevel)}
                  >
                    <SelectTrigger className="w-48">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="beginner">{t('sequences.difficulty.beginner')}</SelectItem>
                      <SelectItem value="intermediate">{t('sequences.difficulty.intermediate')}</SelectItem>
                      <SelectItem value="advanced">{t('sequences.difficulty.advanced')}</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="flex gap-2">
                    <Button onClick={handleSaveEdit} disabled={isSaving || !editName.trim()}>
                      <Save className="w-4 h-4 mr-2" />
                      {t('app.save')}
                    </Button>
                    <Button variant="outline" onClick={handleCancelEdit}>
                      <X className="w-4 h-4 mr-2" />
                      {t('app.cancel')}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3 mb-2">
                    <h1 className="text-2xl font-semibold text-foreground">{currentSequence.name}</h1>
                    <Badge className={`${difficultyColors[currentSequence.difficulty]} border-0`}>
                      <GraduationCap className="w-3 h-3 mr-1" />
                      {t(`sequences.difficulty.${currentSequence.difficulty}`)}
                    </Badge>
                  </div>
                  {currentSequence.description && (
                    <p className="text-muted-foreground text-sm mb-3">{currentSequence.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <Layers className="w-4 h-4" />
                      <span>{currentSequence.poses.length} {t('sequences.poses')}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-4 h-4" />
                      <span>{formatDuration(totalDuration)}</span>
                    </div>
                  </div>
                </>
              )}
            </div>

            {!isEditing && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setActiveTab('player')}
                  className="hidden sm:flex"
                >
                  <Play className="w-4 h-4 mr-2" />
                  {t('sequences.play')}
                </Button>
                <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
                  <Edit3 className="w-4 h-4 mr-2" />
                  {t('app.edit')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowDeleteConfirm(true)}
                  className="text-rose-500 hover:text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="max-w-6xl mx-auto px-6 mt-4">
          <div className="p-4 bg-rose-50 dark:bg-rose-900/30 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-600 dark:text-rose-400 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={clearError} className="text-rose-400 hover:text-rose-600 dark:hover:text-rose-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'player' | 'builder')}>
          <TabsList className="mb-6">
            <TabsTrigger value="builder" className="gap-2">
              <Settings className="w-4 h-4" />
              {t('sequences.builder')}
            </TabsTrigger>
            <TabsTrigger value="player" className="gap-2">
              <Play className="w-4 h-4" />
              {t('sequences.player')}
            </TabsTrigger>
          </TabsList>

          <AnimatePresence mode="wait">
            <TabsContent value="builder" forceMount={activeTab === 'builder' ? true : undefined}>
              <motion.div
                key="builder"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="view-transition-tab-content"
              >
                <SequenceBuilder sequence={currentSequence} />
              </motion.div>
            </TabsContent>
          </AnimatePresence>

          <AnimatePresence mode="wait">
            <TabsContent value="player" forceMount={activeTab === 'player' ? true : undefined}>
              <motion.div
                key="player"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
                className="view-transition-tab-content"
              >
                <SequencePlayer sequence={currentSequence} />
              </motion.div>
            </TabsContent>
          </AnimatePresence>
        </Tabs>
      </main>

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {t('sequences.delete_confirm_title')}
            </h3>
            <p className="text-muted-foreground mb-6">
              {t('sequences.delete_confirm_message', { name: currentSequence.name })}
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setShowDeleteConfirm(false)}>
                {t('app.cancel')}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDelete}
                disabled={isSaving}
                className="bg-rose-500 hover:bg-rose-600"
              >
                {isSaving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    {t('app.delete')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
