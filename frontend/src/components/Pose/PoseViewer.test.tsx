import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
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
  schema_path: "/uploads/schema.png",
  photo_path: "/generated/photo.png",
  muscle_layer_path: "/generated/muscles.png",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  muscles: [],
};

describe("PoseViewer", () => {
  it("renders photo layer by default", () => {
    render(<PoseViewer pose={mockPose} isOpen onClose={() => {}} />);
    const img = screen.getByAltText(/Тадасана/i);
    expect(img.getAttribute("src")).toContain("/api/poses/1/image/photo");
  });

  it("switches to muscles layer", () => {
    render(<PoseViewer pose={mockPose} isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByText("М'язи"));
    const img = screen.getByAltText(/Тадасана - М'язи/i);
    expect(img.getAttribute("src")).toContain("/api/poses/1/image/muscle_layer");
  });
});
