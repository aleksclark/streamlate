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
  const abc = await api.createAbc(adminToken, 'Mute Test Booth');
  abcId = abc.data.id;
  abcSecret = abc.data.secret;
});

test.describe('Mute and Passthrough', () => {
  test('Translator can send mute signal', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Mute Test');
    const sessionId = session.data.id;

    const sessionStartPromise = waitForMessage(abcWs, 'session-start', 5000);
    const translatorWs = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    await waitForMessage(translatorWs, 'welcome');
    await sessionStartPromise;

    translatorWs.send(JSON.stringify({ type: 'mute', muted: true }));
    await new Promise((r) => setTimeout(r, 500));

    translatorWs.send(JSON.stringify({ type: 'mute', muted: false }));
    await new Promise((r) => setTimeout(r, 500));

    translatorWs.close();
    abcWs.close();
    await api.stopSession(adminToken, sessionId);
  });

  test('Translator can send passthrough signal', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Passthrough Test');
    const sessionId = session.data.id;

    const sessionStartPromise = waitForMessage(abcWs, 'session-start', 5000);
    const translatorWs = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    await waitForMessage(translatorWs, 'welcome');
    await sessionStartPromise;

    translatorWs.send(JSON.stringify({ type: 'passthrough', enabled: true }));
    await new Promise((r) => setTimeout(r, 500));

    translatorWs.send(JSON.stringify({ type: 'passthrough', enabled: false }));
    await new Promise((r) => setTimeout(r, 500));

    translatorWs.close();
    abcWs.close();
    await api.stopSession(adminToken, sessionId);
  });

  test('Stop session -> all peers disconnected, state=completed', async () => {
    const { ws: abcWs } = await connectAndWaitWelcome(`/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`);

    const session = await api.createSession(adminToken, abcId, 'Stop Test');
    const sessionId = session.data.id;

    const sessionStartPromise = waitForMessage(abcWs, 'session-start', 5000);
    const translatorWs = await connectWs(
      `/ws/translate/${sessionId}?token=${encodeURIComponent(adminToken)}`
    );
    await waitForMessage(translatorWs, 'welcome');
    await sessionStartPromise;

    const listenerWs = await connectWs(`/ws/listen/${sessionId}`);
    await waitForMessage(listenerWs, 'welcome');

    const sessionStopPromise = waitForMessage(abcWs, 'session-stop', 5000);
    const stopRes = await api.stopSession(adminToken, sessionId);
    const stopData = await stopRes.json();
    expect(stopData.state).toBe('completed');

    const sessionStopMsg = await sessionStopPromise;
    expect(sessionStopMsg.session_id).toBe(sessionId);

    const getRes = await api.getSession(adminToken, sessionId);
    const sessionData = await getRes.json();
    expect(sessionData.state).toBe('completed');

    translatorWs.close();
    abcWs.close();
    listenerWs.close();
  });
});
