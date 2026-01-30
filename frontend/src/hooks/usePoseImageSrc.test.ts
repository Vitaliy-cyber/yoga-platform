import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../services/api", () => ({
  getSignedImageUrl: vi.fn(),
}));

import { getSignedImageUrl } from "../services/api";
import { usePoseImageSrc } from "./usePoseImageSrc";

const getSignedImageUrlMock = vi.mocked(getSignedImageUrl);

describe("usePoseImageSrc", () => {
  beforeEach(() => {
    getSignedImageUrlMock.mockReset();
  });

  it("returns local storage path without fetching signed URL", async () => {
    const { result } = renderHook(() =>
      usePoseImageSrc("/storage/uploads/test.png", 1, "schema")
    );

    await waitFor(() => {
      expect(result.current.src).toBe("/storage/uploads/test.png");
    });

    expect(getSignedImageUrlMock).not.toHaveBeenCalled();
  });

  it("fetches signed URL when direct path is remote", async () => {
    getSignedImageUrlMock.mockResolvedValueOnce(
      "https://example.com/image.png?expires=9999999999&sig=abc"
    );

    const { result } = renderHook(() =>
      usePoseImageSrc("https://example.com/original.png", 2, "photo")
    );

    await waitFor(() => {
      expect(result.current.src).toContain("https://example.com/image.png");
    });

    expect(getSignedImageUrlMock).toHaveBeenCalledTimes(1);
  });

  it("uses cache for repeated requests", async () => {
    getSignedImageUrlMock.mockResolvedValueOnce(
      "https://example.com/cached.png?expires=9999999999&sig=abc"
    );

    const { result } = renderHook(() =>
      usePoseImageSrc("https://example.com/original.png", 3, "photo")
    );

    await waitFor(() => {
      expect(result.current.src).toContain("https://example.com/cached.png");
    });

    const initialCalls = getSignedImageUrlMock.mock.calls.length;

    const { result: result2 } = renderHook(() =>
      usePoseImageSrc("https://example.com/original.png", 3, "photo")
    );

    await waitFor(() => {
      expect(result2.current.src).toContain("https://example.com/cached.png");
    });

    expect(getSignedImageUrlMock.mock.calls.length).toBe(initialCalls);
  });

  it("forces refresh when requested", async () => {
    getSignedImageUrlMock
      .mockResolvedValueOnce("https://example.com/first.png?expires=9999999999&sig=abc")
      .mockResolvedValueOnce("https://example.com/second.png?expires=9999999999&sig=def");

    const { result } = renderHook(() =>
      usePoseImageSrc("https://example.com/original.png", 4, "photo")
    );

    await waitFor(() => {
      expect(result.current.src).toContain("https://example.com/first.png");
    });

    const initialCalls = getSignedImageUrlMock.mock.calls.length;

    await act(async () => {
      await result.current.refresh(true);
    });

    await waitFor(() => {
      expect(result.current.src).toContain("https://example.com/second.png");
    });

    expect(getSignedImageUrlMock.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it("falls back to direct path once on signed URL failure", async () => {
    getSignedImageUrlMock.mockRejectedValueOnce(new Error("fail"));

    const { result } = renderHook(() =>
      usePoseImageSrc("https://example.com/fallback.png", 5, "photo")
    );

    await waitFor(() => {
      expect(result.current.src).toBe("https://example.com/fallback.png");
    });

    expect(result.current.error).toBe(false);

    getSignedImageUrlMock.mockRejectedValueOnce(new Error("fail"));

    await act(async () => {
      await result.current.refresh(true);
    });

    await waitFor(() => {
      expect(result.current.error).toBe(true);
    });
  });
});
