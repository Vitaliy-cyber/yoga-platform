import { test, expect } from "@playwright/test";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";

const USER1_TOKEN =
  process.env.E2E_TEST_TOKEN || "e2e-test-token-playwright-2024";

type Created = { categoryId: number; poseIds: number[]; sequenceId: number };

function shuffle<T>(arr: T[], seed: number): T[] {
  const a = arr.slice();
  let s = seed;
  for (let i = a.length - 1; i > 0; i -= 1) {
    // xorshift32-ish
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    const j = Math.abs(s) % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function createCategory(
  accessToken: string,
  name: string,
): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/categories", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, description: "atomic sequences" }),
  });
  assertNo5xx(res.status, "create category");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: number };
  return json.id;
}

async function createPose(
  accessToken: string,
  data: { code: string; name: string; category_id?: number },
): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/poses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  assertNo5xx(res.status, "create pose");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: number };
  return json.id;
}

async function createSequence(
  accessToken: string,
  name: string,
  poseIds: number[],
): Promise<number> {
  const res = await authedFetch(accessToken, "/api/v1/sequences", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      description: "atomic",
      difficulty: "beginner",
      poses: poseIds.map((pose_id, order_index) => ({
        pose_id,
        order_index,
        duration_seconds: 10,
      })),
    }),
  });
  assertNo5xx(res.status, "create sequence");
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: number };
  return json.id;
}

async function cleanup(accessToken: string, created: Created): Promise<void> {
  await authedFetch(accessToken, `/api/v1/sequences/${created.sequenceId}`, {
    method: "DELETE",
  }).catch(() => undefined);
  for (const id of created.poseIds) {
    // eslint-disable-next-line no-await-in-loop
    await authedFetch(accessToken, `/api/v1/poses/${id}`, {
      method: "DELETE",
    }).catch(() => undefined);
  }
  await authedFetch(accessToken, `/api/v1/categories/${created.categoryId}`, {
    method: "DELETE",
  }).catch(() => undefined);
}

test.describe("Atomic sequences delete+reorder race (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 12);
  const reorderIterations = getEnvInt("ATOMIC_SEQ_REORDER_ITER", 40);
  const removeIterations = getEnvInt("ATOMIC_SEQ_REMOVE_ITER", 20);
  const updateIterations = getEnvInt("ATOMIC_SEQ_UPDATE_ITER", 30);

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(USER1_TOKEN)).accessToken;
  });

  for (const seed of [1, 2, 3, 4, 5]) {
    test(`storm seed=${seed}: delete+reorder+update never 5xx`, async () => {
      const runId = `${Date.now()}-${seed}`;
      const created: Created = { categoryId: 0, poseIds: [], sequenceId: 0 };

      created.categoryId = await createCategory(
        accessToken,
        `Seq Race ${runId}`,
      );
      created.poseIds = await Promise.all(
        Array.from({ length: 8 }, async (_v, i) => {
          const code = `SR${runId}${i}`.slice(0, 20);
          return createPose(accessToken, {
            code,
            name: `Seq Race Pose ${i}`,
            category_id: created.categoryId,
          });
        }),
      );
      created.sequenceId = await createSequence(
        accessToken,
        `Seq Race ${runId}`,
        created.poseIds,
      );

      const seqRes = await authedFetch(
        accessToken,
        `/api/v1/sequences/${created.sequenceId}`,
      );
      assertNo5xx(seqRes.status, "get created sequence");
      expect(seqRes.status).toBe(200);
      const seq = (await seqRes.json()) as {
        poses?: Array<{ id: number; pose_id: number }>;
      };
      const initialSpIds = (seq.poses || []).map((sp) => sp.id);
      expect(initialSpIds.length).toBeGreaterThanOrEqual(8);

      const reorderStorm = async () => {
        for (let i = 0; i < reorderIterations; i += 1) {
          const shuffled = shuffle(initialSpIds, seed * 1000 + i);
          // eslint-disable-next-line no-await-in-loop
          const res = await authedFetch(
            accessToken,
            `/api/v1/sequences/${created.sequenceId}/poses/reorder`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ pose_ids: shuffled }),
            },
          );
          assertNo5xx(res.status, `reorder#${i}`);
          await safeJson(res);
          // Accept 200, 400 (missing ids), 404 (sequence deleted), 409 (conflict)
          if (![200, 400, 404, 409, 422].includes(res.status)) {
            throw new Error(`Unexpected status from reorder: ${res.status}`);
          }
        }
      };

      const removeStorm = async () => {
        for (let i = 0; i < removeIterations; i += 1) {
          const spId = initialSpIds[(seed + i) % initialSpIds.length];
          // eslint-disable-next-line no-await-in-loop
          const res = await authedFetch(
            accessToken,
            `/api/v1/sequences/${created.sequenceId}/poses/${spId}`,
            { method: "DELETE" },
          );
          assertNo5xx(res.status, `remove#${i}`);
          await safeJson(res);
          // Accept 200, 404 (already removed), 409 (conflict)
          if (![200, 404, 409, 422].includes(res.status)) {
            throw new Error(`Unexpected status from remove: ${res.status}`);
          }
        }
      };

      const updateStorm = async () => {
        for (let i = 0; i < updateIterations; i += 1) {
          const spId = initialSpIds[(seed * 7 + i) % initialSpIds.length];
          // eslint-disable-next-line no-await-in-loop
          const res = await authedFetch(
            accessToken,
            `/api/v1/sequences/${created.sequenceId}/poses/${spId}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ duration_seconds: 5 + ((seed + i) % 55) }),
            },
          );
          assertNo5xx(res.status, `update#${i}`);
          await safeJson(res);
          // Accept 200, 404 (deleted), 409 (conflict)
          if (![200, 404, 409, 422].includes(res.status)) {
            throw new Error(`Unexpected status from update: ${res.status}`);
          }
        }
      };

      await concurrentAll(
        [reorderStorm, removeStorm, updateStorm],
        Math.min(concurrency, 3),
      );

      await cleanup(accessToken, created);
    });
  }
});
