import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);

test.describe("Atomic generation notes (upload /generate API edge cases)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    const auth = await loginWithToken(TEST_TOKEN);
    accessToken = auth.accessToken;
    expect(accessToken).toBeTruthy();
  });

  test("upload generate handles weird Unicode additional_notes (never 5xx)", async () => {
    const form = new FormData();
    form.append("schema_file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    form.append("additional_notes", `bad-surrogate:${"\ud800"}`);

    const res = await authedFetch(accessToken, "/api/v1/generate", {
      method: "POST",
      body: form,
    });

    assertNo5xx(res.status, "generate(upload)");
    expect(res.status).toBeLessThan(500);
    if (res.status === 200) {
      const json = (await res.json()) as { task_id?: string };
      expect(json.task_id).toBeTruthy();
    }
  });

  test("upload generate enforces max length for additional_notes (422 over 500 chars)", async () => {
    const formOk = new FormData();
    formOk.append("schema_file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    formOk.append("additional_notes", "x".repeat(500));

    const ok = await authedFetch(accessToken, "/api/v1/generate", {
      method: "POST",
      body: formOk,
    });
    assertNo5xx(ok.status, "generate(upload maxlen ok)");
    expect(ok.status).toBe(200);

    const formTooLong = new FormData();
    formTooLong.append("schema_file", new Blob([tinyPng], { type: "image/png" }), "schema.png");
    formTooLong.append("additional_notes", "x".repeat(501));

    const tooLong = await authedFetch(accessToken, "/api/v1/generate", {
      method: "POST",
      body: formTooLong,
    });
    assertNo5xx(tooLong.status, "generate(upload maxlen tooLong)");
    expect(tooLong.status).toBe(422);
  });
});
