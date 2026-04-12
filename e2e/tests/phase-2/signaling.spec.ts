import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';
import { adminLogin, connectWs, connectAndWaitWelcome, waitForMessage } from '../../fixtures/ws-helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

let api: StreamlateAPI;
let adminToken: string;
let abcId: string;
let abcSecret: string;

test.beforeAll(async () => {
  api = new StreamlateAPI(BASE_URL);
  await api.waitReady(30000);
  const { token } = await adminLogin(api);
  adminToken = token;
  const abc = await api.createAbc(adminToken, 'Signaling Test Booth');
  abcId = abc.data.id;
  abcSecret = abc.data.secret;
});

test.describe('WebSocket signaling', () => {
  test('ABC connects via WebSocket and receives welcome', async () => {
    const ws = await connectWs(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);
    const welcome = await waitForMessage(ws, 'welcome');
    expect(welcome.abc_id).toBe(abcId);
    ws.close();
  });

  test('ABC WebSocket rejects invalid secret', async () => {
    await expect(connectWs(`/ws/abc/${abcId}?token=wrong-secret`)).rejects.toThrow();
  });

  test('Translator connects via WebSocket and receives welcome', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Signaling Test');
    const sessionId = session.data.id;

    const translatorWs = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    const welcome = await waitForMessage(translatorWs, 'welcome');
    expect(welcome.session_id).toBe(sessionId);

    translatorWs.close();
    abcWs.close();
    await api.stopSession(adminToken, sessionId);
  });

  test('Translator WebSocket rejects invalid token', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Auth Test');
    const sessionId = session.data.id;
    await expect(
      connectWs(`/ws/translate/${sessionId}?token=invalid-token`)
    ).rejects.toThrow();

    abcWs.close();
    await api.stopSession(adminToken, sessionId);
  });

  test('Listener connects via WebSocket and receives welcome', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Listener Test');
    const sessionId = session.data.id;

    const translatorWs = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    await waitForMessage(translatorWs, 'welcome');

    const listenerWs = await connectWs(`/ws/listen/${sessionId}`);
    const welcome = await waitForMessage(listenerWs, 'welcome');
    expect(welcome.session_id).toBe(sessionId);

    listenerWs.close();
    translatorWs.close();
    abcWs.close();
    await api.stopSession(adminToken, sessionId);
  });

  test('Ping/pong keepalive works', async () => {
    const { ws } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);
    // Server sends periodic pings every 15s; wait up to 20s for one
    const ping = await waitForMessage(ws, 'ping', 20000);
    expect(ping.type).toBe('ping');
    ws.send(JSON.stringify({ type: 'pong' }));
    ws.close();
  });
});
