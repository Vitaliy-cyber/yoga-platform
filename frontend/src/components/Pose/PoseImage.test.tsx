import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("../../hooks/usePoseImageSrc", () => ({
  usePoseImageSrc: vi.fn(),
}));

import { usePoseImageSrc } from "../../hooks/usePoseImageSrc";
import { PoseImage } from "./PoseImage";

const usePoseImageSrcMock = vi.mocked(usePoseImageSrc);

describe("PoseImage", () => {
  it("renders fallback when error is true", () => {
    usePoseImageSrcMock.mockReturnValue({
      src: "",
      loading: false,
      error: true,
      refresh: vi.fn(),
    });

    render(
      <PoseImage
        poseId={1}
        imageType="schema"
        alt="Fallback"
        fallbackSrc="/fallback.png"
      />
    );

    const img = screen.getByAltText("Fallback") as HTMLImageElement;
    expect(img.src).toContain("/fallback.png");
  });

  it("renders fallback when src is empty", () => {
    usePoseImageSrcMock.mockReturnValue({
      src: "",
      loading: false,
      error: false,
      refresh: vi.fn(),
    });

    render(
      <PoseImage
        poseId={2}
        imageType="photo"
        alt="Empty"
        fallbackSrc="/fallback.png"
      />
    );

    const img = screen.getByAltText("Empty") as HTMLImageElement;
    expect(img.src).toContain("/fallback.png");
  });

  it("retries once on image error", async () => {
    let resolveRefresh: (() => void) | null = null;
    const refresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve;
        })
    );

    usePoseImageSrcMock.mockReturnValue({
      src: "/image.png",
      loading: false,
      error: false,
      refresh,
    });

    render(
      <PoseImage poseId={3} imageType="schema" alt="Retry" />
    );

    const img = screen.getByAltText("Retry");
    act(() => {
      fireEvent.error(img);
      fireEvent.error(img);
    });

    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveRefresh?.();
    });
  });
});
