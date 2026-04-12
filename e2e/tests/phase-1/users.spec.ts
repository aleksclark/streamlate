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

test.describe.serial('Users CRUD', () => {
  let createdUserId: string;

  test('create user returns 201 with matching fields', async () => {
    const token = await freshAdminToken();
    const result = await api.createUser(token, {
      email: 'translator1@example.com',
      password: 'password123',
      display_name: 'Test Translator',
      role: 'translator',
    });
    expect(result.status).toBe(201);
    expect(result.data.email).toBe('translator1@example.com');
    expect(result.data.display_name).toBe('Test Translator');
    expect(result.data.role).toBe('translator');
    expect(result.data.id).toBeTruthy();
    createdUserId = result.data.id;
  });

  test('GET returns the created user with matching fields', async () => {
    const token = await freshAdminToken();
    const res = await api.getUser(token, createdUserId);
    expect(res.status).toBe(200);
    const user = await res.json();
    expect(user.email).toBe('translator1@example.com');
    expect(user.display_name).toBe('Test Translator');
    expect(user.role).toBe('translator');
  });

  test('delete user returns 204', async () => {
    const token = await freshAdminToken();
    const res = await api.deleteUser(token, createdUserId);
    expect(res.status).toBe(204);
  });

  test('GET deleted user returns 404', async () => {
    const token = await freshAdminToken();
    const res = await api.getUser(token, createdUserId);
    expect(res.status).toBe(404);
  });

  test('duplicate email returns 409', async () => {
    const token = await freshAdminToken();
    await api.createUser(token, {
      email: 'dup@example.com',
      password: 'password123',
      display_name: 'Dup User',
      role: 'translator',
    });
    const token2 = await freshAdminToken();
    const res = await api.createUserRaw(token2, {
      email: 'dup@example.com',
      password: 'password456',
      display_name: 'Dup User 2',
      role: 'translator',
    });
    expect(res.status).toBe(409);
  });

  test('non-admin cannot create user (403)', async () => {
    const token = await freshAdminToken();
    await api.createUser(token, {
      email: 'translator_nonadmin@example.com',
      password: 'password123',
      display_name: 'Translator Test',
      role: 'translator',
    });

    const loginResult = await api.login('translator_nonadmin@example.com', 'password123');
    const translatorToken = loginResult.data.access_token;

    const res = await api.createUserRaw(translatorToken, {
      email: 'should_fail@example.com',
      password: 'password123',
      display_name: 'Should Fail',
      role: 'translator',
    });
    expect(res.status).toBe(403);
  });
});
