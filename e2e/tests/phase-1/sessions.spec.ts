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

test.describe.serial('Sessions', () => {
  let abcId: string;
  let sessionId: string;

  test.beforeAll(async () => {
    const token = await freshAdminToken();
    const abc = await api.createAbc(token, 'Session Test Booth');
    abcId = abc.data.id;
  });

  test('create session with idle ABC returns 201', async () => {
    const token = await freshAdminToken();
    const result = await api.createSession(token, abcId, 'Test Session');
    expect(result.status).toBe(201);
    expect(result.data.state).toBe('starting');
    expect(result.data.abc_id).toBe(abcId);
    expect(result.data.session_name).toBe('Test Session');
    sessionId = result.data.id;
  });

  test('create session with in-use ABC returns 409', async () => {
    const token = await freshAdminToken();
    const res = await api.createSessionRaw(token, abcId, 'Should Fail');
    expect(res.status).toBe(409);
  });

  test('stop session works', async () => {
    const token = await freshAdminToken();
    const res = await api.stopSession(token, sessionId);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.state).toBe('completed');
    expect(data.ended_at).toBeTruthy();
  });

  test('RESTART server container - data persists', async () => {
    const password = getAdminPassword();
    let loginRes = await api.login('admin@streamlate.local', password);
    let token = loginRes.data.access_token;

    const userResult = await api.createUser(token, {
      email: 'persist_test@example.com',
      password: 'password123',
      display_name: 'Persist Test',
      role: 'translator',
    });
    expect(userResult.status).toBe(201);
    const userId = userResult.data.id;

    execSync(
      'docker compose -f e2e/docker-compose.yml restart server',
      { cwd: process.env.PROJECT_ROOT || '..', encoding: 'utf-8' }
    );

    await api.waitReady(30000);

    loginRes = await api.login('admin@streamlate.local', password);
    token = loginRes.data.access_token;

    const res = await api.getUser(token, userId);
    expect(res.status).toBe(200);
    const user = await res.json();
    expect(user.email).toBe('persist_test@example.com');
    expect(user.display_name).toBe('Persist Test');
  });
});
