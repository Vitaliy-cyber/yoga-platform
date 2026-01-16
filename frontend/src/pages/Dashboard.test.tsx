import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { render } from "../test/utils";
import { Dashboard } from "./Dashboard";

describe("Dashboard", () => {
  it("renders header", () => {
    render(<Dashboard />);
    expect(screen.getByText("Студія Поз")).toBeInTheDocument();
  });

  it("renders stats cards", () => {
    render(<Dashboard />);
    expect(screen.getByText("Всього поз")).toBeInTheDocument();
    expect(screen.getByText("Завершені")).toBeInTheDocument();
  });
});
