import http from 'node:http';
import { URL } from 'node:url';

const PORT = Number(process.env.PORT || 8000);

const json = (res, status, body, extraHeaders = {}) => {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
};

const notFound = (res) => json(res, 404, { detail: 'Not found' });

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
};

const readJsonBody = async (req) => {
  const raw = await readBody(req);
  if (!raw.length) return null;
  return JSON.parse(raw.toString('utf-8'));
};

const requireAuth = (req, res) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) {
    json(res, 401, { detail: 'Unauthorized' });
    return null;
  }
  const token = auth.slice('Bearer '.length);
  // For E2E we accept any token, but keep a stable user id.
  return { id: 1, token };
};

const nowIso = () => new Date().toISOString();

const state = {
  nextCategoryId: 1,
  nextPoseId: 1,
  nextSequenceId: 1,
  nextSequencePoseId: 1,
  nextMuscleId: 1,
  categories: [],
  poses: [],
  sequences: [],
  muscles: [],
  uploads: new Map(), // key: `${poseId}:schema` => Buffer
};

const defaultMuscles = [
  { name: 'erector_spinae', name_ua: 'Прямий м’яз спини', body_part: 'back' },
  { name: 'latissimus_dorsi', name_ua: 'Найширший м’яз спини', body_part: 'back' },
  { name: 'rectus_abdominis', name_ua: 'Прямий м’яз живота', body_part: 'core' },
  { name: 'quadriceps', name_ua: 'Чотириголовий м’яз стегна', body_part: 'legs' },
];

const computeCategoryName = (categoryId) => {
  const c = state.categories.find((x) => x.id === categoryId);
  return c?.name ?? null;
};

const makePoseResponse = (pose) => ({
  ...pose,
  category_name: pose.category_id ? computeCategoryName(pose.category_id) : null,
  muscles: pose.muscles || [],
});

const parseMultipartSingleFile = (body, contentType) => {
  const boundaryMatch = /boundary=([^;]+)/i.exec(contentType || '');
  if (!boundaryMatch) return null;
  const boundary = `--${boundaryMatch[1]}`;

  const parts = body.toString('binary').split(boundary);
  for (const part of parts) {
    if (!part || part === '--\r\n' || part === '--') continue;
    const idx = part.indexOf('\r\n\r\n');
    if (idx === -1) continue;
    const headerRaw = part.slice(0, idx);
    const dataRaw = part.slice(idx + 4);
    if (!/name=\"file\"/i.test(headerRaw)) continue;

    // Trim closing CRLF and optional trailing '--'
    const trimmed = dataRaw.replace(/\r\n--\r\n?$/, '').replace(/\r\n$/, '');
    return Buffer.from(trimmed, 'binary');
  }
  return null;
};

const handleAuthLogin = async (req, res) => {
  const body = await readJsonBody(req);
  const token = body?.token || 'e2e-token';
  const accessToken = `access-${token}`;
  const refreshToken = `refresh-${token}`;
  json(
    res,
    200,
    {
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: 'bearer',
      expires_in: 3600,
      user: { id: 1, token, display_name: 'E2E User' },
    },
    {
      'set-cookie': `refresh_token=${refreshToken}; HttpOnly; Path=/; SameSite=Lax`,
    }
  );
};

const handleAuthMe = async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  json(res, 200, { id: user.id, token: 'e2e', name: 'E2E User' });
};

const handleCategoriesGet = async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const categories = state.categories.map((c) => ({
    ...c,
    pose_count: state.poses.filter((p) => p.category_id === c.id).length,
  }));
  json(res, 200, categories);
};

const handleCategoriesCreate = async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const category = {
    id: state.nextCategoryId++,
    user_id: user.id,
    name: body?.name || `Category ${Date.now()}`,
    description: body?.description || null,
  };
  state.categories.push(category);
  json(res, 201, category);
};

const handleCategoriesDelete = async (req, res, id) => {
  const user = requireAuth(req, res);
  if (!user) return;
  state.categories = state.categories.filter((c) => c.id !== id);
  // Unassign poses in this category
  state.poses = state.poses.map((p) => (p.category_id === id ? { ...p, category_id: null } : p));
  res.writeHead(204);
  res.end();
};

const handlePosesList = async (req, res, url) => {
  const user = requireAuth(req, res);
  if (!user) return;

  const skip = Number(url.searchParams.get('skip') || 0);
  const limit = Number(url.searchParams.get('limit') || 100);
  const categoryId = url.searchParams.get('category_id');
  const categoryFilter = categoryId ? Number(categoryId) : null;

  const all = state.poses
    .filter((p) => p.user_id === user.id)
    .filter((p) => (categoryFilter ? p.category_id === categoryFilter : true))
    .map(makePoseResponse);

  json(res, 200, {
    items: all.slice(skip, skip + limit),
    total: all.length,
    skip,
    limit,
  });
};

const handlePoseCreate = async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const pose = {
    id: state.nextPoseId++,
    user_id: user.id,
    code: String(body?.code ?? ''),
    name: body?.name || `Pose ${Date.now()}`,
    name_en: body?.name_en || null,
    category_id: body?.category_id ?? null,
    description: body?.description || null,
    effect: body?.effect || null,
    breathing: body?.breathing || null,
    schema_path: null,
    photo_path: null,
    muscle_layer_path: null,
    skeleton_layer_path: null,
    version: 1,
    created_at: nowIso(),
    updated_at: nowIso(),
    muscles: [],
  };
  state.poses.push(pose);
  json(res, 201, makePoseResponse(pose));
};

const handlePoseGet = async (req, res, id) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const pose = state.poses.find((p) => p.id === id && p.user_id === user.id);
  if (!pose) return json(res, 404, { detail: 'Pose not found' });
  json(res, 200, makePoseResponse(pose));
};

const handlePoseDelete = async (req, res, id) => {
  const user = requireAuth(req, res);
  if (!user) return;
  state.poses = state.poses.filter((p) => p.id !== id);
  state.uploads.delete(`${id}:schema`);
  res.writeHead(204);
  res.end();
};

const handlePoseUploadSchema = async (req, res, id) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const pose = state.poses.find((p) => p.id === id && p.user_id === user.id);
  if (!pose) return json(res, 404, { detail: 'Pose not found' });

  const raw = await readBody(req);
  const file = parseMultipartSingleFile(raw, req.headers['content-type']);
  if (!file) return json(res, 400, { detail: 'Missing file' });

  state.uploads.set(`${id}:schema`, file);
  pose.schema_path = `/storage/uploads/${id}/schema.png`;
  pose.updated_at = nowIso();
  json(res, 200, makePoseResponse(pose));
};

const handleStorageGet = async (req, res, poseId) => {
  const buf = state.uploads.get(`${poseId}:schema`);
  if (!buf) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, {
    'content-type': 'image/png',
    'content-length': buf.length,
    'cache-control': 'no-store',
  });
  res.end(buf);
};

const handleMusclesSeed = async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  if (state.muscles.length === 0) {
    for (const m of defaultMuscles) {
      state.muscles.push({ id: state.nextMuscleId++, ...m });
    }
  }
  json(res, 200, state.muscles);
};

const handleMusclesGet = async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  json(res, 200, state.muscles);
};

const computeSequenceDuration = (poses) =>
  (poses || []).reduce((acc, p) => acc + (p.duration_seconds || 0), 0);

const handleSequencesList = async (req, res, url) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const skip = Number(url.searchParams.get('skip') || 0);
  const limit = Number(url.searchParams.get('limit') || 20);

  const all = state.sequences.filter((s) => s.user_id === user.id);
  const items = all.slice(skip, skip + limit).map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    difficulty: s.difficulty,
    duration_seconds: computeSequenceDuration(s.poses),
    pose_count: s.poses.length,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }));
  json(res, 200, { items, total: all.length, skip, limit });
};

const handleSequenceCreate = async (req, res) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const body = await readJsonBody(req);
  const createdAt = nowIso();
  const seq = {
    id: state.nextSequenceId++,
    user_id: user.id,
    name: body?.name || `Sequence ${Date.now()}`,
    description: body?.description || null,
    difficulty: body?.difficulty || 'beginner',
    created_at: createdAt,
    updated_at: createdAt,
    poses: [],
  };

  for (const p of body?.poses || []) {
    const pose = state.poses.find((x) => x.id === p.pose_id);
    if (!pose) continue;
    seq.poses.push({
      id: state.nextSequencePoseId++,
      pose_id: p.pose_id,
      order_index: p.order_index ?? 0,
      duration_seconds: p.duration_seconds ?? 30,
      transition_note: p.transition_note ?? null,
      pose_name: pose.name,
      pose_code: pose.code,
      pose_photo_path: pose.photo_path,
      pose_schema_path: pose.schema_path,
    });
  }

  state.sequences.push(seq);
  json(res, 201, {
    id: seq.id,
    user_id: seq.user_id,
    name: seq.name,
    description: seq.description,
    difficulty: seq.difficulty,
    duration_seconds: computeSequenceDuration(seq.poses),
    created_at: seq.created_at,
    updated_at: seq.updated_at,
    poses: seq.poses,
  });
};

const handleSequenceGet = async (req, res, id) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const seq = state.sequences.find((s) => s.id === id && s.user_id === user.id);
  if (!seq) return json(res, 404, { detail: 'Sequence not found' });
  json(res, 200, {
    id: seq.id,
    user_id: seq.user_id,
    name: seq.name,
    description: seq.description,
    difficulty: seq.difficulty,
    duration_seconds: computeSequenceDuration(seq.poses),
    created_at: seq.created_at,
    updated_at: seq.updated_at,
    poses: seq.poses,
  });
};

const handleSequenceUpdate = async (req, res, id) => {
  const user = requireAuth(req, res);
  if (!user) return;
  const seq = state.sequences.find((s) => s.id === id && s.user_id === user.id);
  if (!seq) return json(res, 404, { detail: 'Sequence not found' });
  const body = await readJsonBody(req);
  if (body?.name) seq.name = body.name;
  if (body?.description !== undefined) seq.description = body.description;
  if (body?.difficulty) seq.difficulty = body.difficulty;
  seq.updated_at = nowIso();
  json(res, 200, {
    id: seq.id,
    user_id: seq.user_id,
    name: seq.name,
    description: seq.description,
    difficulty: seq.difficulty,
    duration_seconds: computeSequenceDuration(seq.poses),
    created_at: seq.created_at,
    updated_at: seq.updated_at,
    poses: seq.poses,
  });
};

const handleSequenceDelete = async (req, res, id) => {
  const user = requireAuth(req, res);
  if (!user) return;
  state.sequences = state.sequences.filter((s) => s.id !== id);
  res.writeHead(204);
  res.end();
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const method = req.method || 'GET';
    const pathname = url.pathname;

    if (method === 'GET' && pathname === '/health') {
      return json(res, 200, { status: 'ok' });
    }

    // Auth
    if (method === 'POST' && pathname === '/api/v1/auth/login') return handleAuthLogin(req, res);
    if (method === 'GET' && pathname === '/api/v1/auth/me') return handleAuthMe(req, res);

    // Categories (v1)
    if (pathname === '/api/v1/categories' && method === 'GET') return handleCategoriesGet(req, res);
    if (pathname === '/api/v1/categories' && method === 'POST') return handleCategoriesCreate(req, res);
    {
      const m = /^\/api\/v1\/categories\/(\d+)$/.exec(pathname);
      if (m && method === 'DELETE') return handleCategoriesDelete(req, res, Number(m[1]));
    }

    // Muscles (v1)
    if (pathname === '/api/v1/muscles/seed' && method === 'POST') return handleMusclesSeed(req, res);
    if (pathname === '/api/v1/muscles' && method === 'GET') return handleMusclesGet(req, res);

    // Poses (v1)
    if (pathname === '/api/v1/poses' && method === 'GET') return handlePosesList(req, res, url);
    if (pathname === '/api/v1/poses' && method === 'POST') return handlePoseCreate(req, res);
    {
      const m = /^\/api\/v1\/poses\/(\d+)$/.exec(pathname);
      if (m && method === 'GET') return handlePoseGet(req, res, Number(m[1]));
      if (m && method === 'DELETE') return handlePoseDelete(req, res, Number(m[1]));
    }
    {
      const m = /^\/api\/v1\/poses\/(\d+)\/schema$/.exec(pathname);
      if (m && method === 'POST') return handlePoseUploadSchema(req, res, Number(m[1]));
    }

    // Sequences (compat + v1 aliases)
    if ((pathname === '/api/sequences' || pathname === '/api/v1/sequences') && method === 'GET') {
      return handleSequencesList(req, res, url);
    }
    if ((pathname === '/api/sequences' || pathname === '/api/v1/sequences') && method === 'POST') {
      return handleSequenceCreate(req, res);
    }
    {
      const m = /^\/api(?:\/v1)?\/sequences\/(\d+)$/.exec(pathname);
      if (m && method === 'GET') return handleSequenceGet(req, res, Number(m[1]));
      if (m && method === 'PUT') return handleSequenceUpdate(req, res, Number(m[1]));
      if (m && method === 'DELETE') return handleSequenceDelete(req, res, Number(m[1]));
    }

    // Storage (local-like paths)
    {
      const m = /^\/storage\/uploads\/(\d+)\/schema\.png$/.exec(pathname);
      if (m && method === 'GET') return handleStorageGet(req, res, Number(m[1]));
    }

    return notFound(res);
  } catch (err) {
    json(res, 500, { detail: err instanceof Error ? err.message : String(err) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log(`[mock-backend] listening on http://127.0.0.1:${PORT}`);
});
