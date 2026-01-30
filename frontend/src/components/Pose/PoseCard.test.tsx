import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { render } from "../../test/utils";
import { PoseCard } from "./PoseCard";
import type { PoseListItem } from "../../types";

vi.mock("../../hooks/usePoseImageSrc", () => ({
  usePoseImageSrc: vi.fn(),
}));

import { usePoseImageSrc } from "../../hooks/usePoseImageSrc";

const usePoseImageSrcMock = vi.mocked(usePoseImageSrc);

const mockPose: PoseListItem = {
  id: 1,
  code: "TADA",
  name: "Тадасана",
  name_en: "Mountain Pose",
  category_id: 1,
  category_name: "Стоячі пози",
  schema_path: null,
  photo_path: null,
};

describe("PoseCard", () => {
  beforeEach(() => {
    usePoseImageSrcMock.mockReturnValue({
      src: "",
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
  });

  it("renders pose name", () => {
    render(<PoseCard pose={mockPose} />);
    expect(screen.getByText("Тадасана")).toBeInTheDocument();
  });

  it("renders category badge when present", () => {
    render(<PoseCard pose={mockPose} />);
    expect(screen.getByText("Стоячі пози")).toBeInTheDocument();
  });

  it("shows photo when provided", () => {
    const poseWithPhoto: PoseListItem = {
      ...mockPose,
      photo_path: "/storage/test.jpg",
    };
    usePoseImageSrcMock.mockReturnValue({
      src: "/storage/test.jpg",
      loading: false,
      error: false,
      refresh: vi.fn(),
    });
    render(<PoseCard pose={poseWithPhoto} />);
    const img = screen.getByAltText("Тадасана");
    return waitFor(() => {
      expect(img.getAttribute("src")).toContain("/storage/test.jpg");
    });
  });

  it("falls back to schema when photo fails", async () => {
    const poseWithSchema: PoseListItem = {
      ...mockPose,
      photo_path: "/storage/photo.jpg",
      schema_path: "/storage/schema.png",
    };

    usePoseImageSrcMock.mockImplementation((...args) => {
      const imageType = args[2];
      if (imageType === "photo") {
        return {
          src: "",
          loading: false,
          error: true,
          refresh: vi.fn(),
        };
      }
      return {
        src: "/storage/schema.png",
        loading: false,
        error: false,
        refresh: vi.fn(),
      };
    });

    render(<PoseCard pose={poseWithSchema} />);

    const img = await screen.findByAltText("Тадасана");
    await waitFor(() => {
      expect(img.getAttribute("src")).toContain("/storage/schema.png");
    });
  });
});
