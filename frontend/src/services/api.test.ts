import { beforeEach, describe, expect, it, vi } from "vitest";

const axiosMock = vi.hoisted(() => {
  const get = vi.fn();
  const post = vi.fn();
  const put = vi.fn();
  const del = vi.fn();
  const requestUse = vi.fn();
  const requestEject = vi.fn();
  const responseUse = vi.fn();
  const responseEject = vi.fn();
  const create = vi.fn(() => ({
    get,
    post,
    put,
    delete: del,
    defaults: { headers: { common: {} as Record<string, string> } },
    interceptors: {
      request: { use: requestUse, eject: requestEject },
      response: { use: responseUse, eject: responseEject },
    },
  }));
  const isCancel = vi.fn(() => false);
  const isAxiosError = vi.fn(() => false);

  return {
    create,
    get,
    post,
    put,
    del,
    requestUse,
    requestEject,
    responseUse,
    responseEject,
    isCancel,
    isAxiosError,
  };
});

vi.mock("axios", () => {
  const axiosDefault = {
    create: axiosMock.create,
    isCancel: axiosMock.isCancel,
    isAxiosError: axiosMock.isAxiosError,
  };
  return {
    default: axiosDefault,
    create: axiosMock.create,
    isCancel: axiosMock.isCancel,
    isAxiosError: axiosMock.isAxiosError,
  };
});

import { categoriesApi, generateApi, musclesApi, posesApi } from "./api";

describe("API Services", () => {
  beforeEach(() => {
    axiosMock.get.mockReset();
    axiosMock.post.mockReset();
    axiosMock.put.mockReset();
    axiosMock.del.mockReset();
    axiosMock.isCancel.mockReset();
    axiosMock.isAxiosError.mockReset();
    axiosMock.isCancel.mockReturnValue(false);
    axiosMock.isAxiosError.mockReturnValue(false);
  });

  describe("categoriesApi", () => {
    it("getAll returns list of categories", async () => {
      const payload = [{ id: 1, name: "Standing", description: null }];
      axiosMock.get.mockResolvedValueOnce({ data: payload });

      const categories = await categoriesApi.getAll();

      expect(categories).toEqual(payload);
      expect(axiosMock.get).toHaveBeenCalledWith("/api/v1/categories", {
        signal: undefined,
      });
    });

    it("getById returns a specific category", async () => {
      const payload = { id: 1, name: "Standing", description: null };
      axiosMock.get.mockResolvedValueOnce({ data: payload });

      const category = await categoriesApi.getById(1);

      expect(category).toEqual(payload);
      expect(axiosMock.get).toHaveBeenCalledWith("/api/v1/categories/1");
    });

    it("create creates a new category", async () => {
      const payload = {
        id: 2,
        name: "Test Category",
        description: "Test Description",
      };
      axiosMock.post.mockResolvedValueOnce({ data: payload });

      const newCategory = await categoriesApi.create({
        name: "Test Category",
        description: "Test Description",
      });

      expect(newCategory).toEqual(payload);
      expect(axiosMock.post).toHaveBeenCalledWith("/api/v1/categories", {
        name: "Test Category",
        description: "Test Description",
      });
    });

    it("getAll throws AbortError when axios cancels request", async () => {
      const canceled = new Error("canceled");
      axiosMock.get.mockRejectedValueOnce(canceled);
      axiosMock.isCancel.mockReturnValueOnce(true);

      await expect(categoriesApi.getAll()).rejects.toMatchObject({
        name: "AbortError",
        message: "Request aborted",
      });
    });

    it("getAll throws AbortError for ERR_CANCELED axios error code", async () => {
      const canceled = Object.assign(new Error("canceled"), { code: "ERR_CANCELED" });
      axiosMock.get.mockRejectedValueOnce(canceled);
      axiosMock.isAxiosError.mockReturnValueOnce(true);

      await expect(categoriesApi.getAll()).rejects.toMatchObject({
        name: "AbortError",
        message: "Request aborted",
      });
    });
  });

  describe("musclesApi", () => {
    it("getAll returns list of muscles", async () => {
      const payload = [
        { id: 1, name: "quadriceps", name_ua: null, body_part: "legs" },
      ];
      axiosMock.get.mockResolvedValueOnce({ data: payload });

      const muscles = await musclesApi.getAll();

      expect(muscles).toEqual(payload);
      expect(axiosMock.get).toHaveBeenCalledWith("/api/v1/muscles", {
        params: {},
      });
    });

    it("getAll with body_part filter returns filtered muscles", async () => {
      const payload = [
        { id: 1, name: "quadriceps", name_ua: null, body_part: "legs" },
      ];
      axiosMock.get.mockResolvedValueOnce({ data: payload });

      const muscles = await musclesApi.getAll("legs");

      expect(muscles).toEqual(payload);
      expect(axiosMock.get).toHaveBeenCalledWith("/api/v1/muscles", {
        params: { body_part: "legs" },
      });
    });

    it("getById returns a specific muscle", async () => {
      const payload = {
        id: 1,
        name: "quadriceps",
        name_ua: null,
        body_part: "legs",
      };
      axiosMock.get.mockResolvedValueOnce({ data: payload });

      const muscle = await musclesApi.getById(1);

      expect(muscle).toEqual(payload);
      expect(axiosMock.get).toHaveBeenCalledWith("/api/v1/muscles/1");
    });
  });

  describe("posesApi", () => {
    it("getAll returns list of poses", async () => {
      const items = [
        {
          id: 1,
          code: "TADASANA",
          name: "Mountain Pose",
          name_en: "Mountain Pose",
          category_id: 1,
          category_name: "Standing",
          schema_path: null,
          photo_path: null,
        },
      ];
      axiosMock.get.mockResolvedValueOnce({
        data: { items, total: 1, skip: 0, limit: 100 },
      });

      const poses = await posesApi.getAll();

      expect(poses).toEqual(items);
      expect(axiosMock.get).toHaveBeenCalledWith("/api/v1/poses", {
        params: { skip: 0, limit: 100 },
        signal: undefined,
      });
    });

    it("search returns matching poses", async () => {
      const payload = [
        {
          id: 1,
          code: "TADASANA",
          name: "Mountain Pose",
          name_en: "Mountain Pose",
          category_id: 1,
          category_name: "Standing",
          schema_path: null,
          photo_path: null,
        },
      ];
      axiosMock.get.mockResolvedValueOnce({ data: payload });

      const poses = await posesApi.search("Mountain");

      expect(poses).toEqual(payload);
      expect(axiosMock.get).toHaveBeenCalledWith("/api/v1/poses/search", {
        params: { q: "Mountain" },
      });
    });

    it("getById returns a specific pose", async () => {
      const payload = { id: 1, name: "Mountain Pose", code: "TADASANA" };
      axiosMock.get.mockResolvedValueOnce({ data: payload });

      const pose = await posesApi.getById(1);

      expect(pose).toEqual(payload);
      expect(axiosMock.get).toHaveBeenCalledWith("/api/v1/poses/1");
    });

    it("getByCategory returns poses for a category", async () => {
      const payload = [{ id: 1, name: "Mountain Pose", category_id: 1 }];
      axiosMock.get.mockResolvedValueOnce({ data: payload });

      const poses = await posesApi.getByCategory(1);

      expect(poses).toEqual(payload);
      expect(axiosMock.get).toHaveBeenCalledWith("/api/v1/poses/category/1");
    });
  });

  describe("generateApi", () => {
    it("generateFromPose forwards generate_muscles=false", async () => {
      const payload = {
        task_id: "task-no-muscles",
        status: "pending",
        progress: 0,
        status_message: "In queue...",
        error_message: null,
        photo_url: null,
        muscles_url: null,
        quota_warning: false,
        analyzed_muscles: null,
      };
      axiosMock.post.mockResolvedValueOnce({ data: payload });

      const response = await generateApi.generateFromPose(42, "keep shoulders down", false);

      expect(response).toEqual(payload);
      expect(axiosMock.post).toHaveBeenCalledWith(
        "/api/v1/generate/from-pose/42",
        {
          additional_notes: "keep shoulders down",
          generate_muscles: false,
        }
      );
    });

    it("generate sends generate_muscles flag via FormData", async () => {
      const payload = {
        task_id: "task-formdata",
        status: "pending",
        progress: 0,
        status_message: "In queue...",
        error_message: null,
        photo_url: null,
        muscles_url: null,
        quota_warning: false,
        analyzed_muscles: null,
      };
      axiosMock.post.mockResolvedValueOnce({ data: payload });

      const file = new File(["fake-png"], "schema.png", { type: "image/png" });
      const response = await generateApi.generate(file, "minimal prompt", false);

      expect(response).toEqual(payload);
      expect(axiosMock.post).toHaveBeenCalledTimes(1);
      const [url, body] = axiosMock.post.mock.calls[0];
      expect(url).toBe("/api/v1/generate");
      expect(body).toBeInstanceOf(FormData);
      const formData = body as FormData;
      expect(formData.get("generate_muscles")).toBe("false");
      expect(formData.get("additional_notes")).toBe("minimal prompt");
      expect(formData.get("schema_file")).toBe(file);
    });

    it("getStatus returns generation status", async () => {
      const payload = {
        task_id: "test-task-123",
        status: "processing",
        progress: 55,
        status_message: "Generating...",
        error_message: null,
        photo_url: null,
        muscles_url: null,
        quota_warning: false,
        analyzed_muscles: null,
      };
      axiosMock.get.mockResolvedValueOnce({ data: payload });

      const status = await generateApi.getStatus("test-task-123");

      expect(status).toEqual(payload);
      expect(axiosMock.get).toHaveBeenCalledWith(
        "/api/v1/generate/status/test-task-123"
      );
    });
  });
});
