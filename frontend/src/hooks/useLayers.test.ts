import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useLayers } from "./useLayers";

describe("useLayers", () => {
  it("initializes with photo as default layer", () => {
    const { result } = renderHook(() => useLayers());
    expect(result.current.activeLayer).toBe("photo");
  });

  it("initializes with custom initial layer", () => {
    const { result } = renderHook(() => useLayers("muscles"));
    expect(result.current.activeLayer).toBe("muscles");
  });

  it("selectLayer changes active layer", () => {
    const { result } = renderHook(() => useLayers("photo"));
    act(() => {
      result.current.selectLayer("muscles");
    });
    expect(result.current.activeLayer).toBe("muscles");
  });

  it("nextLayer cycles between photo and muscles", () => {
    const { result } = renderHook(() => useLayers("photo"));
    act(() => {
      result.current.nextLayer();
    });
    expect(result.current.activeLayer).toBe("muscles");
    act(() => {
      result.current.nextLayer();
    });
    expect(result.current.activeLayer).toBe("photo");
  });

  it("prevLayer cycles between photo and muscles", () => {
    const { result } = renderHook(() => useLayers("photo"));
    act(() => {
      result.current.prevLayer();
    });
    expect(result.current.activeLayer).toBe("muscles");
  });

  it("returns all required functions", () => {
    const { result } = renderHook(() => useLayers());
    expect(typeof result.current.selectLayer).toBe("function");
    expect(typeof result.current.nextLayer).toBe("function");
    expect(typeof result.current.prevLayer).toBe("function");
  });
});
