import React, { useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Square,
  Volume2,
  VolumeX,
  Image as ImageIcon,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import type { Sequence } from '../../types';
import { useSequenceStore } from '../../store/useSequenceStore';
import { PoseImage } from '../Pose';
import { useI18n } from '../../i18n';

interface SequencePlayerProps {
  sequence: Sequence;
}

const formatTime = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const SequencePlayer: React.FC<SequencePlayerProps> = ({ sequence }) => {
  const { t } = useI18n();
  const {
    isPlaying,
    currentPoseIndex,
    remainingTime,
    startPlayer,
    pausePlayer,
    stopPlayer,
    nextPose,
    prevPose,
    setCurrentPoseIndex,
    decrementRemainingTime,
  } = useSequenceStore();

  const intervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [isMuted, setIsMuted] = React.useState(false);

  const currentPose = sequence.poses[currentPoseIndex];
  const progress = currentPose
    ? ((currentPose.duration_seconds - remainingTime) / currentPose.duration_seconds) * 100
    : 0;

  // Initialize AudioContext lazily and cleanup on unmount
  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      try {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      } catch {
        // Audio not supported
      }
    }
    return audioContextRef.current;
  }, []);

  // Cleanup AudioContext on unmount
  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {
          // Ignore close errors
        });
        audioContextRef.current = null;
      }
    };
  }, []);

  // Play beep sound using reusable AudioContext
  const playBeep = useCallback(() => {
    const audioContext = getAudioContext();
    if (!audioContext) return;

    try {
      // Resume context if suspended (browser autoplay policy)
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      oscillator.frequency.value = 880;
      oscillator.type = 'sine';
      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.3);
    } catch {
      // Audio playback failed, continue silently
    }
  }, [getAudioContext]);

  // Timer countdown effect - uses functional update to avoid stale closure
  useEffect(() => {
    if (!isPlaying) {
      // Clear any existing interval when not playing
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Clear any existing interval before setting a new one
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    intervalRef.current = window.setInterval(() => {
      // Use functional update via store's decrementRemainingTime
      // This returns true if we should move to next pose
      const shouldMoveNext = decrementRemainingTime();
      if (shouldMoveNext) {
        if (!isMuted) {
          playBeep();
        }
        nextPose();
      }
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isPlaying, isMuted, nextPose, decrementRemainingTime, playBeep]);

  const handlePoseClick = useCallback(
    (index: number) => {
      setCurrentPoseIndex(index);
    },
    [setCurrentPoseIndex]
  );

  const totalElapsed = sequence.poses
    .slice(0, currentPoseIndex)
    .reduce((acc, p) => acc + p.duration_seconds, 0) +
    (currentPose ? currentPose.duration_seconds - remainingTime : 0);

  const totalDuration = sequence.poses.reduce((acc, p) => acc + p.duration_seconds, 0);
  const overallProgress = (totalElapsed / totalDuration) * 100;

  if (sequence.poses.length === 0) {
    return (
      <div className="text-center py-12 bg-muted rounded-xl">
        <ImageIcon className="w-16 h-16 text-muted-foreground/70 mx-auto mb-4" />
        <p className="text-muted-foreground">{t('sequences.no_poses_to_play')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Main display */}
      <div className="relative bg-gradient-to-br from-stone-900 to-stone-800 rounded-2xl overflow-hidden aspect-video">
        {/* Current pose image */}
        {currentPose && (currentPose.pose_photo_path || currentPose.pose_schema_path) ? (
          <PoseImage
            poseId={currentPose.pose_id}
            imageType={currentPose.pose_photo_path ? "photo" : "schema"}
            directPath={currentPose.pose_photo_path || currentPose.pose_schema_path}
            alt={currentPose.pose_name}
            className="w-full h-full object-contain"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageIcon className="w-24 h-24 text-muted-foreground" />
          </div>
        )}

        {/* Overlay with pose info */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40">
          {/* Top bar */}
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
            <Badge className="bg-card/20 text-white border-0 backdrop-blur-sm">
              {currentPoseIndex + 1} / {sequence.poses.length}
            </Badge>
            <Badge className="bg-card/20 text-white border-0 backdrop-blur-sm">
              {formatTime(totalElapsed)} / {formatTime(totalDuration)}
            </Badge>
          </div>

          {/* Bottom info */}
          <div className="absolute bottom-0 left-0 right-0 p-6">
            <h2 className="text-2xl font-bold text-white mb-1">
              {currentPose?.pose_name || t('sequences.no_pose')}
            </h2>
            {currentPose?.transition_note && (
              <p className="text-white/70 text-sm mb-4">{currentPose.transition_note}</p>
            )}

            {/* Progress bar */}
            <div className="relative h-2 bg-card/20 rounded-full overflow-hidden mb-2">
              <div
                className="absolute inset-y-0 left-0 bg-primary transition-all duration-1000"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Time */}
            <div className="flex items-center justify-between text-white/70 text-sm">
              <span>{formatTime(currentPose ? currentPose.duration_seconds - remainingTime : 0)}</span>
              <span className="text-2xl font-mono text-white">{formatTime(remainingTime)}</span>
              <span>{formatTime(currentPose?.duration_seconds || 0)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="flex items-center justify-center gap-4">
        <Button
          size="icon"
          variant="ghost"
          onClick={() => setIsMuted(!isMuted)}
          className="text-muted-foreground hover:text-foreground"
        >
          <AnimatePresence mode="wait">
            {isMuted ? (
              <motion.span key="muted" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}>
                <VolumeX className="w-5 h-5" />
              </motion.span>
            ) : (
              <motion.span key="unmuted" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}>
                <Volume2 className="w-5 h-5" />
              </motion.span>
            )}
          </AnimatePresence>
        </Button>

        <Button
          size="icon"
          variant="outline"
          onClick={prevPose}
          disabled={currentPoseIndex === 0}
          className="h-12 w-12"
        >
          <SkipBack className="w-5 h-5" />
        </Button>

        <Button
          size="icon"
          onClick={() => isPlaying ? pausePlayer() : startPlayer()}
          className="h-16 w-16 rounded-full bg-primary hover:bg-primary/90"
        >
          <AnimatePresence mode="wait">
            {isPlaying ? (
              <motion.span key="pause" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}>
                <Pause className="w-6 h-6 text-white" />
              </motion.span>
            ) : (
              <motion.span key="play" initial={{ scale: 0.8 }} animate={{ scale: 1 }} exit={{ scale: 0.8 }}>
                <Play className="w-6 h-6 text-white ml-1" />
              </motion.span>
            )}
          </AnimatePresence>
        </Button>

        <Button
          size="icon"
          variant="outline"
          onClick={nextPose}
          disabled={currentPoseIndex >= sequence.poses.length - 1}
          className="h-12 w-12"
        >
          <SkipForward className="w-5 h-5" />
        </Button>

        <Button
          size="icon"
          variant="ghost"
          onClick={stopPlayer}
          className="text-muted-foreground hover:text-rose-500"
        >
          <Square className="w-5 h-5" />
        </Button>
      </div>

      {/* Overall progress */}
      <div className="h-1 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary/50 transition-all duration-500"
          style={{ width: `${overallProgress}%` }}
        />
      </div>

      {/* Pose timeline */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {sequence.poses.map((pose, index) => (
          <button
            key={pose.id}
            onClick={() => handlePoseClick(index)}
            className={`
              flex-shrink-0 w-20 rounded-lg overflow-hidden border-2 transition-all
              ${index === currentPoseIndex
                ? 'border-primary ring-2 ring-primary/30'
                : index < currentPoseIndex
                  ? 'border-emerald-300 opacity-60'
                  : 'border-border opacity-80 hover:opacity-100'
              }
            `}
          >
            <div className="aspect-square bg-muted">
              {pose.pose_photo_path || pose.pose_schema_path ? (
                <PoseImage
                  poseId={pose.pose_id}
                  imageType={pose.pose_photo_path ? "photo" : "schema"}
                  directPath={pose.pose_photo_path || pose.pose_schema_path}
                  alt={pose.pose_name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="w-6 h-6 text-muted-foreground/70" />
                </div>
              )}
            </div>
            <div className="p-1.5 bg-card">
              <p className="text-xs font-medium text-foreground truncate">{pose.pose_name}</p>
              <p className="text-xs text-muted-foreground">{formatTime(pose.duration_seconds)}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};
