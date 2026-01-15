import { describe, it, expect } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import App from "../App";

describe("App", () => {
  it("renders without crashing", () => {
    // App has its own BrowserRouter, so we render directly without wrapper
    rtlRender(<App />);
    expect(document.body).toBeDefined();
  });

  it("renders login screen when unauthenticated", async () => {
    rtlRender(<App />);
    expect(await screen.findByText("Pose Studio")).toBeInTheDocument();
    expect(screen.getByText("Welcome")).toBeInTheDocument();
  });
});
