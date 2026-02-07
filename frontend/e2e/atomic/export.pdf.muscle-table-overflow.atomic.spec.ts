import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export PDF muscle table overflow (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("PDF export survives many muscles (table splits; no 5xx)", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-pdf-many-muscles"))).accessToken;

    const muscleIds: number[] = [];
    const createdMuscles: number[] = [];
    const suffix = Date.now().toString(36).slice(-8);

    const count = 80;
    for (let i = 0; i < count; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await authedFetch(accessToken, "/api/v1/muscles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `pdf_muscle_${suffix}_${i}`,
          body_part: "test",
        }),
      });
      assertNo5xx(res.status, `create muscle#${i}`);
      expect(res.status).toBe(201);
      // eslint-disable-next-line no-await-in-loop
      const json = (await res.json()) as { id?: number };
      expect(typeof json.id).toBe("number");
      const id = json.id as number;
      muscleIds.push(id);
      createdMuscles.push(id);
    }

    const code = `PDFMT_${suffix}`.slice(0, 20);
    const muscles = muscleIds.map((id, idx) => ({
      muscle_id: id,
      activation_level: (idx * 7) % 101,
    }));

    const createPoseRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: "Pose with many muscles",
        muscles,
      }),
    });
    assertNo5xx(createPoseRes.status, "create pose for pdf muscle table");
    expect(createPoseRes.status).toBe(201);
    const pose = (await createPoseRes.json()) as { id?: number };
    const poseId = pose.id as number;

    try {
      const res = await authedFetch(
        accessToken,
        `/api/v1/export/pose/${poseId}/pdf?include_photo=false&include_schema=false&include_muscle_layer=false&include_muscles_list=true&include_description=false&page_size=A4`,
        { headers: { Accept: "application/pdf" } },
      );
      assertNo5xx(res.status, "export pdf many muscles");
      expect(res.status).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(1500);
      const prefix = String.fromCharCode(...bytes.slice(0, 5));
      expect(prefix).toBe("%PDF-");
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      for (const id of createdMuscles) {
        // eslint-disable-next-line no-await-in-loop
        await authedFetch(accessToken, `/api/v1/muscles/${id}`, { method: "DELETE" }).catch(
          () => undefined,
        );
      }
    }
  });
});
