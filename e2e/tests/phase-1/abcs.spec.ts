import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api.js';
import { execSync } from 'child_process';

const api = new StreamlateAPI();

function getAdminPassword(): string {
  const logs = execSync(
    'docker compose -f e2e/docker-compose.yml logs server 2>&1',
    { cwd: process.env.PROJECT_ROOT || '..', encoding: 'utf-8' }
  );
  const match = logs.match(/Password:\s+(\S+)/);
  if (!match) throw new Error('Could not find admin password in server logs');
  return match[1];
}

async function freshAdminToken(): Promise<string> {
  const password = getAdminPassword();
  const result = await api.login('admin@streamlate.local', password);
  return result.data.access_token;
}

test.describe.serial('ABCs CRUD', () => {
  let abcId: string;
  let abcSecret: string;

  test('register ABC returns credentials', async () => {
    const token = await freshAdminToken();
    const result = await api.createAbc(token, 'Main Hall Booth A');
    expect(result.status).toBe(201);
    expect(result.data.id).toBeTruthy();
    expect(result.data.secret).toBeTruthy();
    expect(result.data.secret).toMatch(/^sk_abc_/);
    expect(result.data.name).toBe('Main Hall Booth A');
    abcId = result.data.id;
    abcSecret = result.data.secret;
  });

  test('ABC self-register with correct secret succeeds', async () => {
    const res = await api.abcRegister(abcId, abcSecret);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('registered');
  });

  test('ABC self-register with wrong secret returns 401', async () => {
    const res = await api.abcRegister(abcId, 'sk_abc_wrong_secret');
    expect(res.status).toBe(401);
  });

  test('GET ABC returns details', async () => {
    const token = await freshAdminToken();
    const res = await api.getAbc(token, abcId);
    expect(res.status).toBe(200);
    const abc = await res.json();
    expect(abc.name).toBe('Main Hall Booth A');
    expect(abc.id).toBe(abcId);
  });
});
