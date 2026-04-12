import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';
import { getAdminPassword, connectWs, connectAndWaitWelcome, waitForMessage } from '../../fixtures/ws-helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

let api: StreamlateAPI;
let adminToken: string;
let abcId: string;
let abcSecret: string;

test.beforeAll(async () => {
  api = new StreamlateAPI(BASE_URL);
  await api.waitReady(30000);
  const password = await getAdminPassword(api);
  const login = await api.login('admin@streamlate.local', password);
  adminToken = login.data.access_token;
  const abc = await api.createAbc(adminToken, 'Audio Test Booth');
  abcId = abc.data.id;
  abcSecret = abc.data.secret;
});

test.describe('Audio flow', () => {
  test('ABC sim connects and server reports it online', async () => {
    const ws = await connectWs(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);
    await waitForMessage(ws, 'welcome');

    await new Promise((r) => setTimeout(r, 500));

    const status = await api.getAbcStatus(abcId);
    expect(status.online).toBe(true);

    ws.close();
  });

  test('Start session -> ABC receives session-start via WebSocket', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Flow Test');
    const sessionId = session.data.id;

    const translatorWs = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    await waitForMessage(translatorWs, 'welcome');

    const sessionStart = await waitForMessage(abcWs, 'session-start', 5000);
    expect(sessionStart.session_id).toBe(sessionId);
    expect(sessionStart.session_name).toBe('Flow Test');

    translatorWs.close();
    abcWs.close();
    await api.stopSession(adminToken, sessionId);
  });

  test('Session lifecycle: create -> signaling -> stop -> completed', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Lifecycle Test');
    const sessionId = session.data.id;

    const getRes = await api.getSession(adminToken, sessionId);
    const sessionData = await getRes.json();
    expect(['starting', 'active']).toContain(sessionData.state);

    const translatorWs = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    await waitForMessage(translatorWs, 'welcome');
    await waitForMessage(abcWs, 'session-start', 5000);

    const stopRes = await api.stopSession(adminToken, sessionId);
    const stopData = await stopRes.json();
    expect(stopData.state).toBe('completed');
    expect(stopData.ended_at).toBeTruthy();

    const sessionStopMsg = await waitForMessage(abcWs, 'session-stop', 5000);
    expect(sessionStopMsg.session_id).toBe(sessionId);

    translatorWs.close();
    abcWs.close();
  });

  test('Multiple listeners can join a session', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Multi Listener Test');
    const sessionId = session.data.id;

    const translatorWs = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    await waitForMessage(translatorWs, 'welcome');

    const listener1 = await connectWs(`/ws/listen/${sessionId}`);
    const w1 = await waitForMessage(listener1, 'welcome');
    expect(w1.session_id).toBe(sessionId);

    const listener2 = await connectWs(`/ws/listen/${sessionId}`);
    const w2 = await waitForMessage(listener2, 'welcome');
    expect(w2.session_id).toBe(sessionId);

    const listener3 = await connectWs(`/ws/listen/${sessionId}`);
    const w3 = await waitForMessage(listener3, 'welcome');
    expect(w3.session_id).toBe(sessionId);

    listener1.close();
    listener2.close();
    listener3.close();
    translatorWs.close();
    abcWs.close();
    await api.stopSession(adminToken, sessionId);
  });
});
