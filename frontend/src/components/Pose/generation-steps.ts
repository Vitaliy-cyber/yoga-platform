import { Camera, Activity, Search } from "lucide-react";

/**
 * Generation progress steps used by both GenerateModal and RegenerateModal.
 * Backend progress values (from google_generator.py):
 * - 20% - Generating photo (starts)
 * - 50% - Generating muscles (starts)
 * - 85% - Analyzing active muscles
 * - 100% - Completed
 */
const baseGenerationSteps = [
  { id: "generating_photo", labelKey: "generate.step_photo", icon: Camera, progressThreshold: 20 },
  { id: "generating_muscles", labelKey: "generate.step_muscles", icon: Activity, progressThreshold: 50 },
  { id: "analyzing_muscles", labelKey: "generate.step_analyzing_muscles", icon: Search, progressThreshold: 85 },
] as const;

export type GenerationStep = (typeof baseGenerationSteps)[number];

export type StepState = "complete" | "active" | "pending";

export const getGenerationSteps = (generateMuscles: boolean): readonly GenerationStep[] =>
  generateMuscles
    ? baseGenerationSteps
    : baseGenerationSteps.filter((step) => step.id === "generating_photo");

/**
 * Determine which step state based on progress.
 * @param steps - Visible generation steps for the current task
 * @param stepIndex - Index of the step in the generationSteps array
 * @param progress - Current progress percentage (0-100)
 * @param isComplete - Whether the entire generation is complete
 * @returns The state of the step: "complete", "active", or "pending"
 */
export function getStepState(
  steps: readonly GenerationStep[],
  stepIndex: number,
  progress: number,
  isComplete: boolean
): StepState {
  const step = steps[stepIndex];
  const nextStep = steps[stepIndex + 1];

  if (!step) {
    return "pending";
  }

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
