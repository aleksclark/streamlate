import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api.js';
import { execSync } from 'child_process';

const SERVER_URL = 'http://localhost:8080';
const api = new StreamlateAPI(SERVER_URL);

function getAdminPassword(): string {
  const logs = execSync(
    'docker compose -f e2e/docker-compose.yml logs server 2>&1',
    { cwd: process.env.PROJECT_ROOT || '..', encoding: 'utf-8' }
  );
  const match = logs.match(/Password:\s+(\S+)/);
  if (!match) throw new Error('Could not find admin password in server logs');
  return match[1];
}

test.describe.serial('Phase 8: Full Workflow', () => {
  let adminToken: string;
  let adminPassword: string;
  let translatorUserId: string;
  let translatorToken: string;
  let abcId: string;
  let abcSecret: string;
  let sessionId: string;

  test('1. Server is running with valid health check', async () => {
    const health = await api.health();
    expect(health.status).toBe('ok');
    expect(health.version).toBeTruthy();
  });

  test('2. Login as admin with bootstrap credentials', async () => {
    adminPassword = getAdminPassword();
    const result = await api.login('admin@streamlate.local', adminPassword);
    expect(result.status).toBe(200);
    expect(result.data.access_token).toBeTruthy();
    expect(result.data.user.role).toBe('admin');
    adminToken = result.data.access_token;
  });

  test('3. Create translator user via admin API', async () => {
    const result = await api.createUser(adminToken, {
      email: 'translator-e2e@test.com',
      password: 'test-password-123',
      display_name: 'E2E Translator',
      role: 'translator',
    });
    expect(result.status).toBe(201);
    expect(result.data.email).toBe('translator-e2e@test.com');
    expect(result.data.role).toBe('translator');
    translatorUserId = result.data.id;
  });

  test('4. Register ABC via admin API and get credentials', async () => {
    const result = await api.createAbc(adminToken, 'E2E Test Booth');
    expect(result.status).toBe(201);
    expect(result.data.id).toBeTruthy();
    expect(result.data.secret).toBeTruthy();
    expect(result.data.secret.startsWith('sk_abc_')).toBe(true);
    abcId = result.data.id;
    abcSecret = result.data.secret;
  });

  test('5. ABC can register with its credentials', async () => {
    const res = await api.abcRegister(abcId, abcSecret);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('registered');
  });

  test('6. Login as translator', async () => {
    const result = await api.login(
      'translator-e2e@test.com',
      'test-password-123'
    );
    expect(result.status).toBe(200);
    expect(result.data.user.role).toBe('translator');
    translatorToken = result.data.access_token;
  });

  test('7. Create a translation session', async () => {
    const result = await api.createSession(
      translatorToken,
      abcId,
      'E2E Full Workflow Session',
      '1234'
    );
    expect(result.status).toBe(201);
    expect(result.data.state).toBe('starting');
    expect(result.data.abc_id).toBe(abcId);
    sessionId = result.data.id;
  });

  test('8. Session exists and is in starting state', async () => {
    const res = await api.getSession(translatorToken, sessionId);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(sessionId);
    expect(['starting', 'active'].includes(data.state)).toBe(true);
  });

  test('9. System stats reflect the active session', async () => {
    const res = await fetch(`${SERVER_URL}/api/v1/system/stats`);
    const data = await res.json();
    expect(data.total_users).toBeGreaterThanOrEqual(2);
    expect(data.total_abcs).toBeGreaterThanOrEqual(1);
  });

  test('10. Metrics endpoint includes session data', async () => {
    const res = await fetch(`${SERVER_URL}/metrics`);
    const body = await res.text();
    expect(body).toContain('streamlate_active_sessions');
    expect(body).toContain('streamlate_http_requests_total');
  });

  test('11. Cannot create duplicate session on same ABC', async () => {
    const res = await api.createSessionRaw(
      translatorToken,
      abcId,
      'Duplicate Session'
    );
    expect(res.status).toBe(409);
  });

  test('12. Security headers present on all responses', async () => {
    const res = await fetch(`${SERVER_URL}/api/v1/system/health`);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    expect(res.headers.get('strict-transport-security')).toBeTruthy();
  });

  test('13. Stop session from translator', async () => {
    const res = await api.stopSession(translatorToken, sessionId);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe('completed');
    expect(data.ended_at).toBeTruthy();
  });

  test('14. Stopped session cannot be stopped again', async () => {
    const res = await api.stopSession(translatorToken, sessionId);
    expect(res.status).toBe(409);
  });

  test('15. Session shows as completed', async () => {
    const res = await api.getSession(translatorToken, sessionId);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe('completed');
  });

  test('16. Health check still reports ok after session lifecycle', async () => {
    const health = await api.health();
    expect(health.status).toBe('ok');
  });

  test('17. Admin can list all users', async () => {
    const users = await api.listUsers(adminToken);
    expect(users.items.length).toBeGreaterThanOrEqual(2);
    const translator = users.items.find(
      (u) => u.email === 'translator-e2e@test.com'
    );
    expect(translator).toBeTruthy();
  });

  test('18. Admin can delete the translator user', async () => {
    const res = await api.deleteUser(adminToken, translatorUserId);
    expect(res.status).toBe(204);
  });

  test('19. Deleted user cannot log in', async () => {
    const res = await api.loginRaw(
      'translator-e2e@test.com',
      'test-password-123'
    );
    expect(res.status).toBe(401);
  });

  test('20. OpenAPI spec is valid and complete', async () => {
    const res = await api.openapi();
    const spec = (await res.json()) as Record<string, unknown>;
    expect(spec.openapi).toBeTruthy();
    expect(spec.paths).toBeTruthy();
    const paths = spec.paths as Record<string, unknown>;
    expect(paths['/api/v1/system/health']).toBeTruthy();
    expect(paths['/api/v1/auth/login']).toBeTruthy();
    expect(paths['/api/v1/users']).toBeTruthy();
    expect(paths['/api/v1/sessions']).toBeTruthy();
    expect(paths['/api/v1/abcs']).toBeTruthy();
  });

  test('21. Metrics counters reflect all the API calls made', async () => {
    const res = await fetch(`${SERVER_URL}/metrics`);
    const body = await res.text();

    const extractTotal = (text: string): number => {
      let total = 0;
      const matches = text.matchAll(
        /streamlate_http_requests_total\{[^}]*\}\s+(\d+)/g
      );
      for (const m of matches) {
        total += parseInt(m[1], 10);
      }
      return total;
    };

    const totalRequests = extractTotal(body);
    expect(totalRequests).toBeGreaterThan(10);
  });

  test('22. Admin account still works after all operations', async () => {
    const result = await api.login('admin@streamlate.local', adminPassword);
    expect(result.status).toBe(200);
    expect(result.data.user.role).toBe('admin');
  });
});
