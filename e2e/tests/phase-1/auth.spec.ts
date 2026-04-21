import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api.js';
import { execSync } from 'child_process';

const api = new StreamlateAPI();

function getAdminPassword(): string {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const logs = execSync(
    'docker compose -f e2e/docker-compose.yml logs server 2>&1',
    { cwd: process.env.PROJECT_ROOT || '..', encoding: 'utf-8' }
  );
  const match = logs.match(/Password:\s+(\S+)/);
  if (!match) throw new Error('Could not find admin password in server logs');
  return match[1];
}

let adminToken: string;
let refreshCookie: string;

test.describe.serial('Auth', () => {
  test('login with correct password returns 200 + tokens', async () => {
    const password = getAdminPassword();
    const result = await api.login('admin@streamlate.local', password);
    expect(result.status).toBe(200);
    expect(result.data.access_token).toBeTruthy();
    expect(result.data.expires_in).toBeGreaterThan(0);
    expect(result.data.user.email).toBe('admin@streamlate.local');
    expect(result.data.user.role).toBe('admin');
    adminToken = result.data.access_token;
    refreshCookie = result.refreshCookie || '';
  });

  test('login with wrong password returns 401', async () => {
    const res = await api.loginRaw('admin@streamlate.local', 'wrong-password');
    expect(res.status).toBe(401);
  });

  test('access protected endpoint without token returns 401', async () => {
    const res = await api.meRaw();
    expect(res.status).toBe(401);
  });

  test('access with expired token returns 401', async () => {
    await new Promise((r) => setTimeout(r, 6000));
    const res = await api.meRaw(adminToken);
    expect(res.status).toBe(401);
  });

  test('refresh returns new access token that works', async () => {
    const cookie = refreshCookie.includes('refresh_token=')
      ? refreshCookie.split(';')[0]
      : `refresh_token=${refreshCookie}`;

    const result = await api.refresh(cookie);
    expect(result.status).toBe(200);
    expect(result.data.access_token).toBeTruthy();

    const meRes = await api.me(result.data.access_token);
    expect(meRes.status).toBe(200);
    const meData = await meRes.json();
    expect(meData.email).toBe('admin@streamlate.local');

    adminToken = result.data.access_token;
    if (result.newCookie) {
      refreshCookie = result.newCookie;
    }
  });

  test('revoked refresh token is rejected', async () => {
    const password = getAdminPassword();
    const loginResult = await api.login('admin@streamlate.local', password);
    const cookie = loginResult.refreshCookie?.split(';')[0] || '';

    await api.refresh(cookie);

    const res = await api.refreshRaw(cookie);
    expect(res.status).toBe(401);
  });
});
