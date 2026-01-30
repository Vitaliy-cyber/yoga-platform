import { Lightbulb, Camera, Activity, Search } from "lucide-react";

/**
 * Generation progress steps used by both GenerateModal and RegenerateModal.
 * Backend progress values (from google_generator.py):
 * - 5% - Analyzing pose
 * - 25% - Generating photo (starts)
 * - 55% - Generating muscles (starts)
 * - 85% - Analyzing active muscles
 * - 100% - Completed
 */
export const generationSteps = [
  { id: "analyzing", labelKey: "generate.step_analyzing", icon: Lightbulb, progressThreshold: 5 },
  { id: "generating_photo", labelKey: "generate.step_photo", icon: Camera, progressThreshold: 25 },
  { id: "generating_muscles", labelKey: "generate.step_muscles", icon: Activity, progressThreshold: 55 },
  { id: "analyzing_muscles", labelKey: "generate.step_analyzing_muscles", icon: Search, progressThreshold: 85 },
] as const;

export type GenerationStep = typeof generationSteps[number];

export type StepState = "complete" | "active" | "pending";

/**
 * Determine which step state based on progress.
 * @param stepIndex - Index of the step in the generationSteps array
 * @param progress - Current progress percentage (0-100)
 * @param isComplete - Whether the entire generation is complete
 * @returns The state of the step: "complete", "active", or "pending"
 */
export function getStepState(stepIndex: number, progress: number, isComplete: boolean): StepState {
  const step = generationSteps[stepIndex];
  const nextStep = generationSteps[stepIndex + 1];

  if (isComplete) {
    return "complete";
  }

  // Step is complete if progress has passed the NEXT step's threshold (or 100 if last step)
  const nextThreshold = nextStep?.progressThreshold ?? 100;
  if (progress >= nextThreshold) {
    return "complete";
  }

  // Step is active if progress is >= this step's threshold but < next threshold
  if (progress >= step.progressThreshold) {
    return "active";
  }

  return "pending";
}
