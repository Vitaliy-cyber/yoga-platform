import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken } from "./atomic-http";

test.describe("Atomic export PDF muscle-name newlines (break-it; no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  test("PDF export survives muscle names with many newlines", async () => {
    const accessToken = (await loginWithToken(makeIsolatedToken("export-pdf-muscle-newlines"))).accessToken;

    const crazyName = `${Array.from({ length: 45 }, () => "l").join("\n")}\nend`;

    const createMuscleRes = await authedFetch(accessToken, "/api/v1/muscles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: crazyName, body_part: "test" }),
    });
    assertNo5xx(createMuscleRes.status, "create muscle with newlines");
    expect(createMuscleRes.status).toBe(201);
    const muscle = (await createMuscleRes.json()) as { id?: number };
    const muscleId = muscle.id as number;

    const code = `PDFMN_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const createPoseRes = await authedFetch(accessToken, "/api/v1/poses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        name: "Pose with newline muscle",
        muscles: [{ muscle_id: muscleId, activation_level: 50 }],
      }),
    });
    assertNo5xx(createPoseRes.status, "create pose for pdf newline muscle");
    expect(createPoseRes.status).toBe(201);
    const pose = (await createPoseRes.json()) as { id?: number };
    const poseId = pose.id as number;

    try {
      const res = await authedFetch(
        accessToken,
        `/api/v1/export/pose/${poseId}/pdf?include_photo=false&include_schema=false&include_muscle_layer=false&include_muscles_list=true&include_description=false&page_size=A4`,
        { headers: { Accept: "application/pdf" } },
      );
      assertNo5xx(res.status, "export pdf with newline muscle name");
      expect(res.status).toBe(200);
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.length).toBeGreaterThan(1000);
      const prefix = String.fromCharCode(...bytes.slice(0, 5));
      expect(prefix).toBe("%PDF-");
    } finally {
      await authedFetch(accessToken, `/api/v1/poses/${poseId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
      await authedFetch(accessToken, `/api/v1/muscles/${muscleId}`, { method: "DELETE" }).catch(
        () => undefined,
      );
    }
  });
});
