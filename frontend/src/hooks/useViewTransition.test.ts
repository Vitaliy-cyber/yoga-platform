import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useViewTransition, withViewTransition } from "./useViewTransition";

type MockTransition = {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: () => void;
};

type MockTransitionOptions = {
  rejectReadyOnSkip?: boolean;
  rejectUpdateOnSkip?: boolean;
};

const createMockTransition = ({
  rejectReadyOnSkip = false,
  rejectUpdateOnSkip = false,
}: MockTransitionOptions = {}): MockTransition => {
  let rejectFinished: (reason?: unknown) => void = () => undefined;
  let rejectReady: ((reason?: unknown) => void) | null = null;
  let rejectUpdate: ((reason?: unknown) => void) | null = null;

  const finished = new Promise<void>((_, reject) => {
    rejectFinished = reject;
  });

  const ready = rejectReadyOnSkip
    ? new Promise<void>((_, reject) => {
        rejectReady = reject;
      })
    : Promise.resolve();

  const updateCallbackDone = rejectUpdateOnSkip
    ? new Promise<void>((_, reject) => {
        rejectUpdate = reject;
      })
    : Promise.resolve();

  return {
    finished,
    ready,
    updateCallbackDone,
    skipTransition: () => {
      const error = new DOMException("Skipped ViewTransition due to skipTransition() call");
      rejectFinished(error);
      rejectReady?.(error);
      rejectUpdate?.(error);
    },
  };
};

let transitions: MockTransition[] = [];

const setStartViewTransition = (impl: unknown) => {
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    writable: true,
    value: impl,
  });
};

describe("useViewTransition", () => {
  beforeEach(() => {
    transitions = [];
    const startViewTransitionMock = vi.fn((callback: () => void | Promise<void>) => {
      void callback();
      const transition = createMockTransition();
      transitions.push(transition);
      return transition;
    });
    setStartViewTransition(startViewTransitionMock);
  });

  afterEach(() => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it("does not reject when a transition is skipped", async () => {
    const { result } = renderHook(() => useViewTransition());
    const first = result.current.startTransition(() => undefined);
    const second = result.current.startTransition(() => undefined);

    // Skip the latest transition to settle the promise
    transitions[1].skipTransition();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it("handles ready/updateCallbackDone rejections when a transition is skipped", async () => {
    const startViewTransitionMock = vi.fn((callback: () => void | Promise<void>) => {
      void callback();
      const transition = createMockTransition({
        rejectReadyOnSkip: true,
        rejectUpdateOnSkip: true,
      });
      transitions.push(transition);
      return transition;
    });
    setStartViewTransition(startViewTransitionMock);

    const { result } = renderHook(() => useViewTransition());
    const first = result.current.startTransition(() => undefined);
    const second = result.current.startTransition(() => undefined);

    transitions[1].skipTransition();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it("does not emit unhandledrejection when transitions are skipped", async () => {
    const handler = vi.fn();
    window.addEventListener("unhandledrejection", handler);

    const { result } = renderHook(() => useViewTransition());
    const first = result.current.startTransition(() => undefined);
    const second = result.current.startTransition(() => undefined);

    transitions[1].skipTransition();

    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    await Promise.resolve();

    window.removeEventListener("unhandledrejection", handler);

    expect(handler).not.toHaveBeenCalled();
  });
});

describe("withViewTransition", () => {
  beforeEach(() => {
    transitions = [];
    const startViewTransitionMock = vi.fn((callback: () => void | Promise<void>) => {
      void callback();
      const transition = createMockTransition();
      transitions.push(transition);
      return transition;
    });
    setStartViewTransition(startViewTransitionMock);
  });

  afterEach(() => {
    delete (document as unknown as { startViewTransition?: unknown }).startViewTransition;
  });

  it("does not reject when a transition is skipped", async () => {
    const promise = withViewTransition(() => undefined);
    transitions[0].skipTransition();
    await expect(promise).resolves.toBeUndefined();
  });
});
