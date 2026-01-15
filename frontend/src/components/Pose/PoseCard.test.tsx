import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "../../test/utils";
import { PoseCard } from "./PoseCard";
import type { PoseListItem } from "../../types";

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
      photo_path: "/uploads/test.jpg",
    };
    render(<PoseCard pose={poseWithPhoto} />);
    const img = screen.getByAltText("Тадасана");
    expect(img).toHaveAttribute("src", "/uploads/test.jpg");
  });
});
