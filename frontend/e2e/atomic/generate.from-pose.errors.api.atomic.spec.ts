import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic generate/from-pose error handling", () => {
  test.describe.configure({ mode: "serial" });

  test("from-pose rejects poses without schema (400, never 5xx)", async () => {
    const auth = await loginWithToken(makeIsolatedToken(`gen-from-pose-noschema-${TEST_TOKEN}`));
    const accessToken = auth.accessToken;

    const code = `NOSCH_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic ${code}` }),
    });
    assertNo5xx(createRes.status, "create pose");
    expect(createRes.status).toBe(201);
    const created = (await safeJson(createRes)) as { id?: unknown } | undefined;
    expect(typeof created?.id).toBe("number");
    const poseId = created?.id as number;

    const genRes = await authedFetch(accessToken, `/api/v1/generate/from-pose/${poseId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assertNo5xx(genRes.status, "generate/from-pose without schema");
    expect(genRes.status).toBe(400);
    const err = (await safeJson(genRes)) as { detail?: unknown } | undefined;
    expect(String(err?.detail || "")).toContain("no schema");

    await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(() => undefined);
  });
});

