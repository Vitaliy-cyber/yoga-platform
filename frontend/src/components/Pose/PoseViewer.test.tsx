import { describe, it, expect } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { render } from "../../test/utils";
import { PoseViewer } from "./PoseViewer";
import type { Pose } from "../../types";

const mockPose: Pose = {
  id: 1,
  code: "TADA",
  name: "Тадасана",
  name_en: "Mountain Pose",
  category_id: 1,
  category_name: "Standing",
  description: "Basic pose",
  effect: null,
  breathing: null,
  schema_path: "/storage/schema.png",
  photo_path: "/storage/photo.png",
  muscle_layer_path: "/storage/muscles.png",
  skeleton_layer_path: null,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  muscles: [],
};

describe("PoseViewer", () => {
  it("renders photo layer by default", () => {
    render(<PoseViewer pose={mockPose} isOpen onClose={() => {}} />);
    const img = screen.getByAltText(/Тадасана/i);
    return waitFor(() => {
      expect(img.getAttribute("src")).toContain("/storage/photo.png");
    });
  });

  it("switches to muscles layer", () => {
    render(<PoseViewer pose={mockPose} isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByText(/Muscles/i));
    const img = screen.getByAltText(/Тадасана - Muscles/i);
    return waitFor(() => {
      expect(img.getAttribute("src")).toContain("/storage/muscles.png");
    });
  });
});
