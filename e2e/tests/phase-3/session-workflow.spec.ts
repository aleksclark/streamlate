import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';
import { adminLogin, connectAndWaitWelcome } from '../../fixtures/ws-helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const CLIENT_URL = process.env.TRANSLATION_CLIENT_URL || 'http://localhost:3001';

let api: StreamlateAPI;
let adminEmail: string;
let adminPassword: string;
let adminToken: string;
let abcId: string;
let abcSecret: string;

test.beforeAll(async () => {
  api = new StreamlateAPI(BASE_URL);
  await api.waitReady(30000);
  adminEmail = 'admin@streamlate.local';
  const loginResult = await adminLogin(api);
  adminPassword = loginResult.password;
  adminToken = loginResult.token;
  const abc = await api.createAbc(adminToken, 'Session Workflow Booth');
  abcId = abc.data.id;
  abcSecret = abc.data.secret;
});

async function loginViaUI(page: import('@playwright/test').Page) {
  await page.goto(`${CLIENT_URL}/login`);
  await page.fill('input#email', adminEmail);
  await page.fill('input#password', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });
}

test.describe('Session workflow', () => {
  test('Click Start -> session screen appears with Connected state', async ({ page }) => {
    const { ws: abcWs } = await connectAndWaitWelcome(
      `/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`
    );

    await loginViaUI(page);

    await page.waitForFunction(
      (id: string) => {
        const el = document.querySelector(`[data-testid="abc-${id}"]`);
        return el?.getAttribute('data-abc-status') === 'idle';
      },
      abcId,
      { timeout: 15000 }
    );

    await page.click(`[data-testid="start-${abcId}"]`);

    await page.waitForSelector('[data-testid="session-view"]', { timeout: 15000 });
    expect(await page.isVisible('[data-testid="session-view"]')).toBe(true);

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="connection-status"]');
      return el?.getAttribute('data-state') === 'connected';
    }, { timeout: 30000 });

    const stateAttr = await page.locator('[data-testid="connection-status"]').getAttribute('data-state');
    expect(stateAttr).toBe('connected');

    await page.click('[data-testid="end-session"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });

    abcWs.close();
  });

  test('End Session returns to dashboard, ABC status returns to idle', async ({ page }) => {
    const { ws: abcWs } = await connectAndWaitWelcome(
      `/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`
    );

    await loginViaUI(page);

    await page.waitForFunction(
      (id: string) => {
        const el = document.querySelector(`[data-testid="abc-${id}"]`);
        return el?.getAttribute('data-abc-status') === 'idle';
      },
      abcId,
      { timeout: 15000 }
    );

    await page.click(`[data-testid="start-${abcId}"]`);
    await page.waitForSelector('[data-testid="session-view"]', { timeout: 15000 });

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="connection-status"]');
      const state = el?.getAttribute('data-state');
      return state === 'connected' || state === 'connecting';
    }, { timeout: 20000 });

    await page.click('[data-testid="end-session"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });

    await page.waitForFunction(
      (id: string) => {
        const el = document.querySelector(`[data-testid="abc-${id}"]`);
        return el?.getAttribute('data-abc-status') === 'idle';
      },
      abcId,
      { timeout: 15000 }
    );

    const statusAttr = await page.locator(`[data-testid="abc-${abcId}"]`).getAttribute('data-abc-status');
    expect(statusAttr).toBe('idle');

    abcWs.close();
  });

  test('Session duration timer increments', async ({ page }) => {
    const { ws: abcWs } = await connectAndWaitWelcome(
      `/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`
    );

    await loginViaUI(page);

    await page.waitForFunction(
      (id: string) => {
        const el = document.querySelector(`[data-testid="abc-${id}"]`);
        return el?.getAttribute('data-abc-status') === 'idle';
      },
      abcId,
      { timeout: 15000 }
    );

    await page.click(`[data-testid="start-${abcId}"]`);
    await page.waitForSelector('[data-testid="session-view"]', { timeout: 15000 });

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="connection-status"]');
      return el?.getAttribute('data-state') === 'connected';
    }, { timeout: 30000 });

    await page.waitForTimeout(3000);

    const durationText = await page.textContent('[data-testid="session-duration"]');
    expect(durationText).toBeTruthy();
    expect(durationText).not.toBe('00:00:00');

    await page.click('[data-testid="end-session"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });
    abcWs.close();
  });

  test('Channel health shows values', async ({ page }) => {
    const { ws: abcWs } = await connectAndWaitWelcome(
      `/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`
    );

    await loginViaUI(page);

    await page.waitForFunction(
      (id: string) => {
        const el = document.querySelector(`[data-testid="abc-${id}"]`);
        return el?.getAttribute('data-abc-status') === 'idle';
      },
      abcId,
      { timeout: 15000 }
    );

    await page.click(`[data-testid="start-${abcId}"]`);
    await page.waitForSelector('[data-testid="session-view"]', { timeout: 15000 });

    await page.waitForFunction(() => {
      const el = document.querySelector('[data-testid="connection-status"]');
      return el?.getAttribute('data-state') === 'connected';
    }, { timeout: 30000 });

    await page.waitForSelector('[data-testid="channel-health"]', { timeout: 15000 });
    expect(await page.isVisible('[data-testid="channel-health"]')).toBe(true);

    await page.click('[data-testid="end-session"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });
    abcWs.close();
  });
});
