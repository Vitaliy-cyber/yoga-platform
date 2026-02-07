import { test, expect } from "@playwright/test";
import { login, getAccessToken, createPose, deletePose } from "../test-api";
import { authedFetch, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic Unicode surrogate rejection (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    await login();
    const token = getAccessToken();
    expect(token).toBeTruthy();
    accessToken = token as string;
  });

  test("create pose rejects unpaired surrogate (422) and response JSON is parseable", async () => {
    const evil = "\ud800";
    const res = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: `SUR_${Date.now().toString(36).slice(-8)}`.slice(0, 20),
        name: "surrogate-create",
        description: `ok ${evil} ok`,
      }),
    });

    assertNo5xx(res.status, "create with surrogate");
    expect(res.status).toBe(422);
    expect(await safeJson(res)).toBeTruthy();
  });

  test("update pose rejects unpaired surrogate (422) and never corrupts the pose", async () => {
    const pose = await createPose({
      code: `SU_OK_${Date.now().toString(36).slice(-8)}`.slice(0, 20),
      name: "surrogate-update-target",
      description: "ok",
    });

    try {
      const getRes = await authedFetch(accessToken, `/api/v1/poses/${pose.id}`);
      assertNo5xx(getRes.status, "get pose before surrogate update");
      expect(getRes.status).toBe(200);
      const before = (await getRes.json()) as { version: number; description?: string | null };
      expect(typeof before.version).toBe("number");

      const evil = "\ud800";
      const updateRes = await authedFetch(accessToken, `/api/v1/poses/${pose.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: `bad ${evil} bad`,
          version: before.version,
          change_note: "atomic surrogate reject",
        }),
      });
      assertNo5xx(updateRes.status, "update with surrogate");
      expect(updateRes.status).toBe(422);
      expect(await safeJson(updateRes)).toBeTruthy();

      const getAfter = await authedFetch(accessToken, `/api/v1/poses/${pose.id}`);
      assertNo5xx(getAfter.status, "get pose after surrogate update");
      expect(getAfter.status).toBe(200);
      const after = (await getAfter.json()) as { description?: string | null };
      expect(after.description ?? "").toBe(before.description ?? "");
    } finally {
      await deletePose(pose.id);
    }
  });
});

