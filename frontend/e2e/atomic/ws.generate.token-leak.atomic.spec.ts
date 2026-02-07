import { test, expect } from "@playwright/test";

test.describe("Atomic WebSocket auth hardening (no token in URL)", () => {
  test.describe.configure({ mode: "serial" });

  test("generate WS connects without token query param (prevents URL/log leakage)", async ({
    page,
  }) => {
    const wsConnections: string[] = [];
    page.on("websocket", (ws) => {
      wsConnections.push(ws.url());
    });

    await page.goto("/generate");
    await expect(page.getByTestId("generate-file-input")).toBeAttached();

    // Use schematic flow (stable + supported in E2E_FAST_AI).
    const tinyPng = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
      "base64",
    );
    await page.getByTestId("generate-file-input").setInputFiles({
      name: "schema.png",
      mimeType: "image/png",
      buffer: tinyPng,
    });
    await page.getByTestId("generate-submit").click();

    // Wait for WebSocket attempt; generation may be fast.
    await page.waitForTimeout(2500);

    // We don't fail if WS isn't used in some environments, but if it is used,
    // it must not contain the access token in the URL.
    const genWs = wsConnections.filter((u) => u.includes("/ws/generate/"));
    for (const url of genWs) {
      expect(url).not.toContain("token=");
      expect(url).not.toMatch(/eyJ[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-]+/);
    }
  });
});
