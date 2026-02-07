import { test, expect } from "@playwright/test";
import { TEST_TOKEN } from "../fixtures";
import { authedFetch, loginWithToken, safeJson } from "./atomic-http";
import { assertNo5xx } from "./atomic-helpers";

test.describe("Atomic generation notes (from-text API edge cases)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    const auth = await loginWithToken(TEST_TOKEN);
    accessToken = auth.accessToken;
    expect(accessToken).toBeTruthy();
  });

  const postFromText = async (body: unknown) => {
    const res = await authedFetch(accessToken, "/api/v1/generate/from-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    assertNo5xx(res.status, "generate/from-text");
    return res;
  };

  test("from-text accepts basic additional_notes", async () => {
    const res = await postFromText({
      description: "Atomic: generate from text (basic) — shoulders engaged, neutral spine.",
      additional_notes: "Keep lighting soft; avoid artifacts.",
    });
    expect(res.status).toBe(200);
    const json = await safeJson(res);
    expect((json as { task_id?: string } | undefined)?.task_id).toBeTruthy();
  });

  test("from-text trims whitespace-only additional_notes (still valid)", async () => {
    const res = await postFromText({
      description: "Atomic: whitespace notes should normalize to None and still succeed.",
      additional_notes: "   \n\t  ",
    });
    expect(res.status).toBe(200);
  });

  test("from-text rejects unpaired surrogate in additional_notes (never 5xx)", async () => {
    const res = await postFromText({
      description: "Atomic: invalid-unicode should be validated before DB write.",
      additional_notes: `bad-surrogate:${"\ud800"}`,
    });
    expect(res.status).toBe(422);
  });

  test("from-text rejects unpaired surrogate in description (never 5xx)", async () => {
    const res = await postFromText({
      description: `bad-desc:${"\ud800"}:end`,
      additional_notes: "ok",
    });
    expect(res.status).toBe(422);
  });

  test("from-text survives null byte in additional_notes (never 5xx)", async () => {
    const res = await postFromText({
      description: "Atomic: null byte in notes should not crash the request path.",
      additional_notes: `nullbyte:\u0000:end`,
    });
    expect(res.status).toBeLessThan(500);
  });

  test("from-text enforces max_length on additional_notes (never 5xx)", async () => {
    const res = await postFromText({
      description: "Atomic: max length should return 422 rather than 5xx.",
      additional_notes: `too-long:${"x".repeat(600)}`,
    });
    expect(res.status).toBe(422);
  });

  test("from-text trims description before validation (never 5xx)", async () => {
    const res = await postFromText({
      description: "    Atomic: trimmed description should still meet min_length.    ",
      additional_notes: "ok",
    });
    expect(res.status).toBe(200);
  });

  test("from-text with wrong types never 5xx", async () => {
    const res = await postFromText({
      description: "Atomic: wrong type should be a 422, not 500.",
      additional_notes: 123,
    });
    expect(res.status).toBe(422);
  });
});

