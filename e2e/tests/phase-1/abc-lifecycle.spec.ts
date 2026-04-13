import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';
import { adminLogin, connectWs, connectAndWaitWelcome } from '../../fixtures/ws-helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

let api: StreamlateAPI;
let adminToken: string;

test.beforeAll(async () => {
  api = new StreamlateAPI(BASE_URL);
  await api.waitReady(30000);
  const { token } = await adminLogin(api);
  adminToken = token;
});

test.describe.serial('ABC Lifecycle: register → connect → online', () => {
  let abcId: string;
  let abcSecret: string;

  test('create ABC and get credentials', async () => {
    const result = await api.createAbc(adminToken, 'Lifecycle Test Booth');
    expect(result.status).toBe(201);
    expect(result.data.id).toBeTruthy();
    expect(result.data.secret).toBeTruthy();
    abcId = result.data.id;
    abcSecret = result.data.secret;
  });

  test('register returns signaling_url', async () => {
    const res = await api.abcRegister(abcId, abcSecret);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('registered');
    expect(data.signaling_url).toBeTruthy();
    expect(data.signaling_url).toContain(`/ws/abc/${abcId}`);
  });

  test('ABC status is offline before WS connect', async () => {
    const status = await api.getAbcStatus(abcId);
    expect(status.online).toBe(false);
  });

  test('connecting WebSocket makes ABC online, disconnecting makes it offline', async () => {
    const { ws } = await connectAndWaitWelcome(
      `/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`
    );

    await new Promise((r) => setTimeout(r, 500));

    const onlineStatus = await api.getAbcStatus(abcId);
    expect(onlineStatus.online).toBe(true);

    ws.close();
    await new Promise((r) => setTimeout(r, 500));

    const offlineStatus = await api.getAbcStatus(abcId);
    expect(offlineStatus.online).toBe(false);
  });
});
