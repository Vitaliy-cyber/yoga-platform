import { test, expect } from "@playwright/test";
import { login, getAccessToken, createPose, deletePose, createSequence, deleteSequence } from "../test-api";
import { authedFetch } from "./atomic-http";
import { assertNo5xx, concurrentAll, getEnvInt } from "./atomic-helpers";
import { getCorePoseIdA, getCorePoseIdB } from "../test-data";

type SequenceResponse = { id: number; poses: Array<{ id: number; order_index: number; pose_id: number }> };

test.describe("Atomic sequences race conditions", () => {
  test.describe.configure({ mode: "serial" });

  const concurrency = getEnvInt("ATOMIC_CONCURRENCY", 10);

  let accessToken = "";
  let sequenceId: number | null = null;
  const createdPoseIds: number[] = [];

  test.beforeAll(async () => {
    await login();
    const token = getAccessToken();
    expect(token).toBeTruthy();
    accessToken = token as string;
  });

  test.afterAll(async () => {
    if (sequenceId) {
      await deleteSequence(sequenceId).catch(() => undefined);
    }
    for (const id of createdPoseIds) {
      // eslint-disable-next-line no-await-in-loop
      await deletePose(id).catch(() => undefined);
    }
  });

  test("concurrent add_pose_to_sequence does not 5xx (unique order_index contention)", async () => {
    const p1 = await createPose({
      code: `SR${Date.now().toString(36).slice(-8)}a`.slice(0, 20),
      name: "Seq race A",
      description: "atomic",
    });
    const p2 = await createPose({
      code: `SR${Date.now().toString(36).slice(-8)}b`.slice(0, 20),
      name: "Seq race B",
      description: "atomic",
    });
    createdPoseIds.push(p1.id, p2.id);

    const seq = await createSequence({
      name: `Seq race ${Date.now()}`,
      description: "atomic",
      difficulty: "beginner",
      poses: [],
    });
    sequenceId = seq.id;

    const tasks = [p1.id, p2.id].map((poseId) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/sequences/${sequenceId}/poses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pose_id: poseId,
          order_index: 0, // default triggers append logic; races can create same order index
          duration_seconds: 30,
        }),
      });
      assertNo5xx(res.status, "add_pose_to_sequence race");
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 2));
    expect(statuses.length).toBe(2);

    const getRes = await authedFetch(accessToken, `/api/v1/sequences/${sequenceId}`);
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as SequenceResponse;
    const orderIndices = body.poses.map((p) => p.order_index);
    expect(new Set(orderIndices).size).toBe(orderIndices.length);
  });

  test("concurrent reorder does not 5xx", async () => {
    test.skip(!sequenceId, "requires sequence from prior test");

    const getRes = await authedFetch(accessToken, `/api/v1/sequences/${sequenceId}`);
    expect(getRes.status).toBe(200);
    const body = (await getRes.json()) as SequenceResponse;
    test.skip(body.poses.length < 2, "needs at least 2 poses to reorder");

    const ids = body.poses.map((p) => p.id);
    const reversed = [...ids].reverse();

    const tasks = [ids, reversed].map((poseIds) => async () => {
      const res = await authedFetch(accessToken, `/api/v1/sequences/${sequenceId}/poses/reorder`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pose_ids: poseIds }),
      });
      assertNo5xx(res.status, "reorder race");
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 2));
    expect(statuses.length).toBe(2);
  });

  test("adding a core pose twice fails gracefully (no 5xx)", async () => {
    test.skip(!sequenceId, "requires sequence from prior tests");
    const coreA = getCorePoseIdA() ?? 0;
    const coreB = getCorePoseIdB() ?? 0;
    const poseId = coreA || coreB;
    test.skip(!poseId, "needs seeded core pose id");

    const tasks = Array.from({ length: 10 }, () => async () => {
      const res = await authedFetch(accessToken, `/api/v1/sequences/${sequenceId}/poses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pose_id: poseId, order_index: 0, duration_seconds: 30 }),
      });
      assertNo5xx(res.status, "duplicate add to sequence");
      return res.status;
    });

    const statuses = await concurrentAll(tasks, Math.min(concurrency, 5));
    expect(statuses.length).toBe(10);
  });
});
