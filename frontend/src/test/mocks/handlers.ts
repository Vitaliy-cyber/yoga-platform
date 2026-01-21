/**
 * MSW Handlers - Minimal Configuration
 *
 * This file is intentionally minimal. The MSW server is configured with
 * "bypass" mode, meaning unhandled requests go to the real API.
 *
 * Tests should use real API calls. Only add handlers here when:
 * 1. Testing specific error scenarios (400, 500, etc.)
 * 2. Testing loading states that require delayed responses
 * 3. Testing edge cases that can't be reproduced with real API
 *
 * To add a handler in a specific test:
 *
 *   import { server } from '../test/setup';
 *   import { http, HttpResponse } from 'msw';
 *
 *   server.use(
 *     http.post('/api/auth/login', () => {
 *       return HttpResponse.json({ detail: 'Error' }, { status: 500 });
 *     })
 *   );
 */

// Empty by default - all requests go to real API
export const handlers = [];
