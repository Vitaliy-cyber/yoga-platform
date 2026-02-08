import { describe, expect, it } from "vitest";

import { getGenerationSteps, getStepState } from "./generation-steps";

describe("generation-steps", () => {
  it("returns only photo step when muscles generation is disabled", () => {
    const steps = getGenerationSteps(false);
    expect(steps).toHaveLength(1);
    expect(steps[0]?.id).toBe("generating_photo");
  });

  it("returns full step list when muscles generation is enabled", () => {
    const steps = getGenerationSteps(true);
    expect(steps.map((step) => step.id)).toEqual([
      "generating_photo",
      "generating_muscles",
      "analyzing_muscles",
    ]);
  });

  it("computes active step from filtered list correctly", () => {
    const steps = getGenerationSteps(false);
    expect(getStepState(steps, 0, 20, false)).toBe("active");
    expect(getStepState(steps, 0, 90, false)).toBe("active");
  });

  it("marks step complete when generation is complete", () => {
    const steps = getGenerationSteps(false);
    expect(getStepState(steps, 0, 100, true)).toBe("complete");
  });
});

