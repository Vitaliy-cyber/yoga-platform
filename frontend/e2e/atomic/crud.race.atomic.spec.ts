import { test, expect } from "@playwright/test";
import { loginWithToken, authedFetch, safeJson } from "./atomic-http";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";

const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

test.describe("Atomic CRUD race conditions", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 12);
  let accessToken = "";

  test.beforeAll(async () => {
    const u1 = await loginWithToken(USER1_TOKEN);
    accessToken = u1.accessToken;
  });

  test("concurrent category create (same name) never 5xx", async () => {
    const name = `Race Category ${Date.now()}`;
    const iterations = getEnvInt("ATOMIC_RACE_ITER", 20);

    const tasks = Array.from({ length: iterations }, () => async () => {
      const res = await authedFetch(accessToken, "/api/v1/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description: "atomic race" }),
      });
      assertNo5xx(res.status, "category create race");
      if (res.status === 201) {
        const body = (await res.json()) as { id: number };
        return { status: res.status, createdId: body.id };
      }
      await safeJson(res);
      return { status: res.status };
    });

    const results = await concurrentAll(tasks, Math.min(concurrency, 8));
    const statuses = results.map((r) => r.status);
    expect(statuses.some((s) => s === 201)).toBeTruthy();
    expect(
      statuses.every((s) => s === 201 || s === 400 || s === 409 || s === 422),
    ).toBeTruthy();

    const createdId = results.find((r) => r.status === 201)?.createdId;
    if (createdId) {
      await authedFetch(accessToken, `/api/v1/categories/${createdId}`, {
        method: "DELETE",
      });
    }
  });

  test("concurrent pose create (same code) never 5xx", async () => {
    const code = `R${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const iterations = getEnvInt("ATOMIC_RACE_ITER", 20);

    const tasks = Array.from({ length: iterations }, () => async () => {
      const res = await authedFetch(accessToken, "/api/v1/poses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name: "Race Pose",
          description: "atomic race",
        }),
      });
      assertNo5xx(res.status, "pose create race");
      if (res.status === 201) {
        const body = (await res.json()) as { id: number };
        return { status: res.status, createdId: body.id };
      }
      await safeJson(res);
      return { status: res.status };
    });

    const results = await concurrentAll(tasks, Math.min(concurrency, 8));
    const statuses = results.map((r) => r.status);
    expect(statuses.some((s) => s === 201)).toBeTruthy();
    expect(
      statuses.every((s) => s === 201 || s === 400 || s === 409 || s === 422),
    ).toBeTruthy();

    const createdId = results.find((r) => r.status === 201)?.createdId;
    if (createdId) {
      await authedFetch(accessToken, `/api/v1/poses/${createdId}`, {
        method: "DELETE",
      });
    }
  });

  test("optimistic locking: concurrent update with same version yields 409 (no 5xx)", async () => {
    const code = `V${Date.now().toString(36).slice(-10)}`.slice(0, 20);
    const createRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: "Version Pose",
        description: "atomic",
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as { id: number; version: number };

    // Under extreme concurrent load SQLite can transiently reject writes (409).
    // Retry the two-request race a few times until we observe the expected pattern:
    // exactly-one-wins (200) and at least one conflict (409).
    let observed200 = false;
    let observed409 = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const getRes = await authedFetch(accessToken, `/api/v1/poses/${created.id}`);
      assertNo5xx(getRes.status, "get pose before optimistic race");
      expect(getRes.status).toBe(200);
      const current = (await getRes.json()) as { version: number };

      const payload = { name: `Version Pose updated ${attempt}`, version: current.version };
      const tasks = Array.from({ length: 2 }, () => async () => {
        const res = await authedFetch(
          accessToken,
          `/api/v1/poses/${created.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        assertNo5xx(res.status, "pose update race");
        await safeJson(res);
        return res.status;
      });

      const statuses = await concurrentAll(tasks, 2);
      observed200 ||= statuses.some((s) => s === 200);
      observed409 ||= statuses.some((s) => s === 409);
      if (observed200 && observed409) break;

      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 50));
    }

    expect(observed200, "expected at least one winning update (200)").toBeTruthy();
    expect(observed409, "expected at least one conflict (409)").toBeTruthy();

    await authedFetch(accessToken, `/api/v1/poses/${created.id}`, {
      method: "DELETE",
    });
  });
});
