import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api.js';
import { execSync } from 'child_process';

const api = new StreamlateAPI();

test.describe('Bootstrap', () => {
  test('first-run admin credentials appear in server container logs', async () => {
    const logs = execSync(
      'docker compose -f e2e/docker-compose.yml logs server 2>&1',
      { cwd: process.env.PROJECT_ROOT || '..', encoding: 'utf-8' }
    );
    expect(logs).toContain('admin@streamlate.local');
    expect(logs).toMatch(/[Pp]assword/);
  });

  test('health check returns 200 with valid JSON', async () => {
    const health = await api.health();
    expect(health.status).toBe('ok');
    expect(health.version).toBeTruthy();
  });

  test('OpenAPI spec is served at /api/openapi.json', async () => {
    const res = await api.openapi();
    expect(res.status).toBe(200);
    const spec = await res.json();
    expect(spec.openapi).toBeTruthy();
    expect(spec.paths).toBeTruthy();
  });
});
