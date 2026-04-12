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
  const abc = await api.createAbc(adminToken, 'Reconnect Test Booth');
  abcId = abc.data.id;
  abcSecret = abc.data.secret;
});

test.describe('Reconnection handling', () => {
  test('ABC can reconnect after disconnect', async () => {
    const ws1 = await connectWs(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);
    await waitForMessage(ws1, 'welcome');

    let status = await api.getAbcStatus(abcId);
    expect(status.online).toBe(true);

    ws1.close();
    await new Promise((r) => setTimeout(r, 1000));

    status = await api.getAbcStatus(abcId);
    expect(status.online).toBe(false);

    const ws2 = await connectWs(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);
    await waitForMessage(ws2, 'welcome');

    await new Promise((r) => setTimeout(r, 500));
    status = await api.getAbcStatus(abcId);
    expect(status.online).toBe(true);

    ws2.close();
  });

  test('Translator can reconnect to same session', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Reconnect Session');
    const sessionId = session.data.id;

    const sessionStartPromise = waitForMessage(abcWs, 'session-start', 5000);
    const translatorWs1 = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    await waitForMessage(translatorWs1, 'welcome');
    await sessionStartPromise;

    translatorWs1.close();
    await new Promise((r) => setTimeout(r, 500));

    const translatorWs2 = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    const welcome2 = await waitForMessage(translatorWs2, 'welcome');
    expect(welcome2.session_id).toBe(sessionId);

    translatorWs2.close();
    abcWs.close();
    await api.stopSession(adminToken, sessionId);
  });

  test('New listener can join after previous listener disconnects', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Listener Reconnect');
    const sessionId = session.data.id;

    const translatorWs = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    await waitForMessage(translatorWs, 'welcome');

    const listener1 = await connectWs(`/ws/listen/${sessionId}`);
    await waitForMessage(listener1, 'welcome');
    listener1.close();
    await new Promise((r) => setTimeout(r, 500));

    const listener2 = await connectWs(`/ws/listen/${sessionId}`);
    const welcome = await waitForMessage(listener2, 'welcome');
    expect(welcome.session_id).toBe(sessionId);

    listener2.close();
    translatorWs.close();
    abcWs.close();
    await api.stopSession(adminToken, sessionId);
  });

  test('Health endpoint returns stats for active session', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Health Test');
    const sessionId = session.data.id;

    const sessionStartPromise = waitForMessage(abcWs, 'session-start', 5000);
    const translatorWs = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    await waitForMessage(translatorWs, 'welcome');
    await sessionStartPromise;

    await new Promise((r) => setTimeout(r, 2000));

    const health = await api.getSessionHealth(adminToken, sessionId);
    expect(health.session_id).toBe(sessionId);
    expect(typeof health.latency_ms).toBe('number');
    expect(typeof health.packet_loss).toBe('number');
    expect(typeof health.jitter_ms).toBe('number');
    expect(typeof health.bitrate_kbps).toBe('number');

    translatorWs.close();
    abcWs.close();
    await api.stopSession(adminToken, sessionId);
  });

  test('Health endpoint returns 404 for non-active session', async () => {
    const healthRes = await api.getSessionHealthRaw(adminToken, 'non-existent-session');
    expect(healthRes.status).toBe(404);
  });
});
