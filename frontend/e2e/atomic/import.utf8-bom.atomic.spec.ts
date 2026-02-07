import { test, expect } from "@playwright/test";
import { assertNo5xx } from "./atomic-helpers";
import { authedFetch, loginWithToken, makeIsolatedToken, safeJson } from "./atomic-http";

function withUtf8Bom(bytes: Uint8Array): Uint8Array {
  const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
  const out = new Uint8Array(bom.length + bytes.length);
  out.set(bom, 0);
  out.set(bytes, bom.length);
  return out;
}

async function uploadFile(
  accessToken: string,
  path: "/api/v1/import/poses/json" | "/api/v1/import/poses/csv",
  filename: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<Response> {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: contentType }), filename);
  return authedFetch(accessToken, path, { method: "POST", body: form });
}

async function deleteByCode(accessToken: string, code: string): Promise<void> {
  const getRes = await authedFetch(accessToken, `/api/v1/poses/code/${encodeURIComponent(code)}`);
  if (getRes.status !== 200) return;
  const json = (await getRes.json()) as { id?: number };
  if (typeof json.id !== "number") return;
  await authedFetch(accessToken, `/api/v1/poses/${json.id}`, { method: "DELETE" });
}

test.describe("Atomic import UTF-8 BOM handling (no 5xx)", () => {
  test.describe.configure({ mode: "serial" });

  let accessToken = "";

  test.beforeAll(async () => {
    accessToken = (await loginWithToken(makeIsolatedToken("import-bom"))).accessToken;
  });

  test("import poses/json accepts UTF-8 BOM (created=1) and never 5xx", async () => {
    const code = `BOMJ_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const payload = JSON.stringify([{ code, name: "BOM JSON Pose", description: "ok" }]);
    const bytes = withUtf8Bom(new TextEncoder().encode(payload));

    let ok = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await uploadFile(accessToken, "/api/v1/import/poses/json", "poses.json", bytes, "application/json");
      assertNo5xx(res.status, "import poses/json with BOM");

      if (res.status === 409 && attempt < 9) {
        // sqlite contention under heavy atomic parallel load
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 60 * (2 ** attempt)));
        continue;
      }

      expect(res.status).toBe(200);
      // eslint-disable-next-line no-await-in-loop
      const body = (await safeJson(res)) as
        | { created?: number; errors?: number; items?: Array<{ status?: string; message?: string }> }
        | undefined;
      expect(body).toBeTruthy();

      const item = body?.items?.[0];
      const status = (item?.status || "").toLowerCase();
      const msg = item?.message || "";
      const retryable =
        msg.includes("Conflict") || msg.includes("conflict") || msg.includes("retry");

      if ((body?.errors ?? 0) === 0 && (body?.created ?? 0) === 1) {
        ok = true;
        break;
      }
      if (retryable && attempt < 9) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 80 + attempt * 40));
        continue;
      }

      throw new Error(
        `BOM JSON import did not succeed: created=${body?.created ?? "?"} errors=${body?.errors ?? "?"} itemStatus=${status || "?"} msg=${msg}`,
      );
    }
    expect(ok, "BOM JSON import should eventually succeed under contention").toBeTruthy();

    await deleteByCode(accessToken, code);
  });

  test("import poses/csv accepts UTF-8 BOM in headers (created=1) and never 5xx", async () => {
    const code = `BOMC_${Date.now().toString(36).slice(-8)}`.slice(0, 20);
    const csv = `code,name,description\n${code},BOM CSV Pose,ok\n`;
    const bytes = withUtf8Bom(new TextEncoder().encode(csv));

    let ok = false;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await uploadFile(accessToken, "/api/v1/import/poses/csv", "poses.csv", bytes, "text/csv");
      assertNo5xx(res.status, "import poses/csv with BOM");

      if (res.status === 409 && attempt < 9) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 60 * (2 ** attempt)));
        continue;
      }

      expect(res.status).toBe(200);
      // eslint-disable-next-line no-await-in-loop
      const body = (await safeJson(res)) as
        | { created?: number; errors?: number; items?: Array<{ status?: string; message?: string }> }
        | undefined;
      expect(body).toBeTruthy();

      const item = body?.items?.[0];
      const status = (item?.status || "").toLowerCase();
      const msg = item?.message || "";
      const retryable =
        msg.includes("Conflict") || msg.includes("conflict") || msg.includes("retry");

      if ((body?.errors ?? 0) === 0 && (body?.created ?? 0) === 1) {
        ok = true;
        break;
      }
      if (retryable && attempt < 9) {
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 80 + attempt * 40));
        continue;
      }

      throw new Error(
        `BOM CSV import did not succeed: created=${body?.created ?? "?"} errors=${body?.errors ?? "?"} itemStatus=${status || "?"} msg=${msg}`,
      );
    }
    expect(ok, "BOM CSV import should eventually succeed under contention").toBeTruthy();

    await deleteByCode(accessToken, code);
  });
});
