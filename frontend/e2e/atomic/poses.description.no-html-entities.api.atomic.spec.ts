import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic pose description should not contain HTML entities", () => {
  test.describe.configure({ mode: "serial" });

  test("create/get/update roundtrip preserves quotes and apostrophes", async () => {
    const auth = await loginWithToken(makeIsolatedToken(`pose-desc-entities-${TEST_TOKEN}`));
    const accessToken = auth.accessToken;

    const description = `Г'ян мудра. Манtra: "Cat Cat Cat Cat".`;
    const effect = `Ефект: розслаблення "шиї" та плечей.`;
    const breathing = `Дихання: 4-4-4-4 (box breathing) — не "перестарайся".`;

    const code = `DESC_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: `Atomic ${code}`, description, effect, breathing }),
    });
    assertNo5xx(createRes.status, "create pose (description entities)");
    expect(createRes.status).toBe(201);

    const created = (await safeJson(createRes)) as { id?: unknown; description?: unknown } | undefined;
    expect(typeof created?.id).toBe("number");
    const poseId = created?.id as number;

    const assertNoEntities = (value: unknown) => {
      expect(typeof value).toBe("string");
      const s = String(value);
      expect(s).not.toContain("&quot;");
      expect(s).not.toContain("&#x27;");
      expect(s).not.toContain("&#39;");
    };

    assertNoEntities((created as unknown as { description?: unknown }).description);

    const getRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "GET" });
    assertNo5xx(getRes.status, "get pose (description entities)");
    expect(getRes.status).toBe(200);
    const got = (await safeJson(getRes)) as {
      description?: unknown;
      effect?: unknown;
      breathing?: unknown;
      version?: unknown;
    };
    expect(got.description).toBe(description);
    expect(got.effect).toBe(effect);
    expect(got.breathing).toBe(breathing);
    assertNoEntities(got.description);
    assertNoEntities(got.effect);
    assertNoEntities(got.breathing);
    expect(typeof got.version).toBe("number");

    const updatedDesc = `Оновлено: Г'ян + "Cat" x2.`;
    const putRes = await authedFetch(accessToken, `/api/v1/poses/${poseId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description: updatedDesc, version: got.version }),
    });
    assertNo5xx(putRes.status, "update pose (description entities)");
    expect(putRes.status).toBe(200);
    const putJson = (await safeJson(putRes)) as { description?: unknown } | undefined;
    expect(putJson?.description).toBe(updatedDesc);
    assertNoEntities(putJson?.description);

    await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
      () => undefined,
    );
  });
});

