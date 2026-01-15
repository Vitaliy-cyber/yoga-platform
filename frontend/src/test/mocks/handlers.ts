import { http, HttpResponse } from "msw";

// Mock user data
const mockUser = {
  id: 1,
  token: "test-user-token",
  name: "Test User",
  created_at: "2024-01-01T00:00:00Z",
  last_login: "2024-01-02T00:00:00Z",
};

// Mock data
const mockCategories = [
  {
    id: 1,
    name: "Стоячі пози",
    name_en: "Standing Poses",
    description: "Пози стоячи",
    pose_count: 2,
  },
  {
    id: 2,
    name: "Сидячі пози",
    name_en: "Seated Poses",
    description: "Пози сидячи",
    pose_count: 1,
  },
  {
    id: 3,
    name: "Інверсії",
    name_en: "Inversions",
    description: "Перевернуті пози",
    pose_count: 1,
  },
];

const mockMuscles = [
  {
    id: 1,
    name: "Квадрицепс",
    name_en: "Quadriceps",
    body_part: "legs",
    color: "#FF6B6B",
  },
  {
    id: 2,
    name: "Біцепс",
    name_en: "Biceps",
    body_part: "arms",
    color: "#4ECDC4",
  },
  { id: 3, name: "Прес", name_en: "Abs", body_part: "core", color: "#45B7D1" },
];

const mockPoses = [
  {
    id: 1,
    code: "TADA",
    name: "Тадасана",
    name_en: "Mountain Pose",
    category_id: 1,
    category_name: "Стоячі пози",
    description: "Основна стояча поза",
    effect: "Покращує поставу",
    breathing: "Рівне дихання",
    duration_seconds: 60,
    difficulty: "beginner",
    schema_path: null,
    photo_path: null,
    muscle_layer_path: null,
    muscles: [],
  },
  {
    id: 2,
    code: "VIRA1",
    name: "Вірабхадрасана I",
    name_en: "Warrior I",
    category_id: 1,
    category_name: "Стоячі пози",
    description: "Поза воїна",
    effect: "Зміцнює ноги",
    breathing: "Глибоке дихання",
    duration_seconds: 30,
    difficulty: "intermediate",
    schema_path: null,
    photo_path: null,
    muscle_layer_path: null,
    muscles: [{ id: 1, name: "Квадрицепс", activation_level: 80 }],
  },
];

export const handlers = [
  // Auth endpoints
  http.post("/api/auth/login", async ({ request }) => {
    const body = (await request.json()) as { token: string };
    if (!body.token) {
      return HttpResponse.json(
        { detail: "Token is required" },
        { status: 422 }
      );
    }
    return HttpResponse.json({
      access_token: "mock-jwt-token-xyz",
      token_type: "bearer",
      user: { ...mockUser, token: body.token },
    });
  }),

  http.get("/api/auth/me", ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { detail: "Not authenticated" },
        { status: 401 }
      );
    }
    return HttpResponse.json(mockUser);
  }),

  http.put("/api/auth/me", async ({ request }) => {
    const authHeader = request.headers.get("Authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return HttpResponse.json(
        { detail: "Not authenticated" },
        { status: 401 }
      );
    }
    const body = (await request.json()) as { name?: string };
    return HttpResponse.json({ ...mockUser, ...body });
  }),

  // Health check
  http.get("/api/health", () => {
    return HttpResponse.json({ status: "healthy" });
  }),

  // Root endpoint
  http.get("/api/", () => {
    return HttpResponse.json({
      message: "Yoga Pose Platform API",
      version: "1.0.0",
    });
  }),

  // Categories
  http.get("/api/categories", () => {
    return HttpResponse.json(mockCategories);
  }),

  http.get("/api/categories/:id", ({ params }) => {
    const category = mockCategories.find((c) => c.id === Number(params.id));
    if (!category) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(category);
  }),

  http.post("/api/categories", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const newCategory = {
      id: mockCategories.length + 1,
      ...body,
      pose_count: 0,
    };
    return HttpResponse.json(newCategory, { status: 201 });
  }),

  // Muscles
  http.get("/api/muscles", ({ request }) => {
    const url = new URL(request.url);
    const bodyPart = url.searchParams.get("body_part");
    if (bodyPart) {
      return HttpResponse.json(
        mockMuscles.filter((m) => m.body_part === bodyPart),
      );
    }
    return HttpResponse.json(mockMuscles);
  }),

  http.get("/api/muscles/:id", ({ params }) => {
    const muscle = mockMuscles.find((m) => m.id === Number(params.id));
    if (!muscle) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(muscle);
  }),

  http.post("/api/muscles/seed", () => {
    return HttpResponse.json({ seeded: mockMuscles.length });
  }),

  // Poses - specific routes first, then parameterized routes
  http.get("/api/poses/search", ({ request }) => {
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.toLowerCase() || "";
    const results = mockPoses.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.name_en.toLowerCase().includes(query) ||
        p.code.toLowerCase().includes(query),
    );
    return HttpResponse.json(results);
  }),

  http.get("/api/poses/category/:categoryId", ({ params }) => {
    const poses = mockPoses.filter(
      (p) => p.category_id === Number(params.categoryId),
    );
    return HttpResponse.json(poses);
  }),

  http.get("/api/poses", () => {
    return HttpResponse.json(mockPoses);
  }),

  http.get("/api/poses/:id", ({ params }) => {
    const pose = mockPoses.find((p) => p.id === Number(params.id));
    if (!pose) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(pose);
  }),

  http.post("/api/poses", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const newPose = {
      id: mockPoses.length + 1,
      ...body,
      schema_path: null,
      photo_path: null,
      muscle_layer_path: null,
      muscles: [],
    };
    return HttpResponse.json(newPose, { status: 201 });
  }),

  // Generate
  http.post("/api/generate", () => {
    return HttpResponse.json({
      task_id: "test-task-123",
      status: "pending",
      progress: 0,
      status_message: "In queue...",
      error_message: null,
      photo_url: null,
      muscles_url: null,
      quota_warning: false,
    });
  }),

  http.get("/api/generate/status/:taskId", ({ params }) => {
    return HttpResponse.json({
      task_id: params.taskId,
      status: "completed",
      progress: 100,
      status_message: "Completed",
      error_message: null,
      photo_url: "/generated/test-photo.png",
      muscles_url: "/generated/test-muscles.png",
      quota_warning: false,
    });
  }),
];
