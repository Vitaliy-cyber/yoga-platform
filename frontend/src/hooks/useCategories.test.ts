import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { mockGetAll, mockSetCategories } = vi.hoisted(() => ({
  mockGetAll: vi.fn(),
  mockSetCategories: vi.fn(),
}));

vi.mock("../services/api", () => ({
  categoriesApi: {
    getAll: mockGetAll,
  },
  isAbortRequestError: (error: unknown) =>
    error instanceof Error && error.name === "AbortError",
}));

vi.mock("../store/useAppStore", () => ({
  useAppStore: () => ({
    categories: [],
    categoriesFetchedAt: null,
    setCategories: mockSetCategories,
  }),
}));

vi.mock("../store/useAuthStore", () => ({
  useAuthStore: () => ({
    isAuthenticated: true,
  }),
}));

import { useCategories } from "./useCategories";

describe("useCategories", () => {
  beforeEach(() => {
    mockGetAll.mockReset();
    mockSetCategories.mockReset();
  });

  it("passes AbortSignal to categories API", async () => {
    mockGetAll.mockResolvedValueOnce([]);

    renderHook(() => useCategories());

    await waitFor(() => {
      expect(mockGetAll).toHaveBeenCalledTimes(1);
    });
    expect(mockGetAll.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
  });

  it("ignores aborted requests without setting error/logging", async () => {
    const abortError = new Error("Request aborted");
    abortError.name = "AbortError";
    mockGetAll.mockRejectedValueOnce(abortError);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result } = renderHook(() => useCategories());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(mockSetCategories).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("normalizes axios network errors to a user-friendly message", async () => {
    mockGetAll.mockRejectedValueOnce(new Error("Network Error"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { result } = renderHook(() => useCategories());

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });

    expect(result.current.error).toBe(
      "Network error. Please check your connection and try again.",
    );
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
