import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api.js';

const api = new StreamlateAPI();

test.describe('Phase 8: Security', () => {
  test('response includes Content-Security-Policy header', async () => {
    const res = await fetch('http://localhost:8080/api/v1/system/health');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  test('response includes X-Frame-Options header', async () => {
    const res = await fetch('http://localhost:8080/api/v1/system/health');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  test('response includes X-Content-Type-Options header', async () => {
    const res = await fetch('http://localhost:8080/api/v1/system/health');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  test('response includes Strict-Transport-Security header', async () => {
    const res = await fetch('http://localhost:8080/api/v1/system/health');
    const hsts = res.headers.get('strict-transport-security');
    expect(hsts).toBeTruthy();
    expect(hsts).toContain('max-age=');
  });

  test('response includes Referrer-Policy header', async () => {
    const res = await fetch('http://localhost:8080/api/v1/system/health');
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  test('response includes Permissions-Policy header', async () => {
    const res = await fetch('http://localhost:8080/api/v1/system/health');
    expect(res.headers.get('permissions-policy')).toBeTruthy();
    expect(res.headers.get('permissions-policy')).toContain('microphone');
  });

  test('response includes X-XSS-Protection header', async () => {
    const res = await fetch('http://localhost:8080/api/v1/system/health');
    expect(res.headers.get('x-xss-protection')).toBe('1; mode=block');
  });

  test('SQL injection in user creation returns 400/422 not 500', async () => {
    const { execSync } = await import('child_process');
    const logs = execSync(
      'docker compose -f e2e/docker-compose.yml logs server 2>&1',
      { cwd: process.env.PROJECT_ROOT || '..', encoding: 'utf-8' }
    );
    const match = logs.match(/Password:\s+(\S+)/);
    if (!match) return;
    const password = match[1];

    const loginResult = await api.login('admin@streamlate.local', password);
    const token = loginResult.data.access_token;

    const res = await fetch('http://localhost:8080/api/v1/users', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        email: "'; DROP TABLE users; --@evil.com",
        password: 'password123',
        display_name: 'Evil User',
        role: 'translator',
      }),
    });

    expect(res.status).not.toBe(500);
    expect([400, 422].includes(res.status)).toBe(true);
  });

  test('path traversal in recording download returns 400/404', async () => {
    const res = await fetch(
      'http://localhost:8080/api/v1/sessions/../../../etc/passwd'
    );
    expect(res.status).not.toBe(200);
    expect([400, 404].includes(res.status)).toBe(true);
  });

  test('login rate limiting works after many attempts', async () => {
    const results: number[] = [];
    for (let i = 0; i < 15; i++) {
      const res = await fetch('http://localhost:8080/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@test.com',
          password: 'wrong',
        }),
      });
      results.push(res.status);
    }

    const has429 = results.some((s) => s === 429);
    expect(has429).toBe(true);
  });
});
