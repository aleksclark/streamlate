import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';
import { getAdminPassword, connectAndWaitWelcome } from '../../fixtures/ws-helpers';

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
  adminPassword = await getAdminPassword(api);
  const login = await api.login(adminEmail, adminPassword);
  adminToken = login.data.access_token;
  const abc = await api.createAbc(adminToken, 'Dashboard Test Booth');
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

test.describe('Dashboard', () => {
  test('Dashboard lists ABCs from server', async ({ page }) => {
    await loginViaUI(page);

    const abcList = page.locator('[data-testid="abc-list"]');
    await expect(abcList).toBeVisible();

    const abcRow = page.locator(`[data-testid="abc-${abcId}"]`);
    await expect(abcRow).toBeVisible({ timeout: 10000 });
    const name = await abcRow.textContent();
    expect(name).toContain('Dashboard Test Booth');
  });

  test('ABC with connected WebSocket shows as idle (green)', async ({ page }) => {
    const { ws: abcWs } = await connectAndWaitWelcome(
      `/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`
    );

    await loginViaUI(page);

    await page.waitForTimeout(2000);
    await page.waitForFunction(
      (id: string) => {
        const el = document.querySelector(`[data-testid="abc-${id}"]`);
        return el?.getAttribute('data-abc-status') === 'idle';
      },
      abcId,
      { timeout: 15000 }
    );

    const abcRow = page.locator(`[data-testid="abc-${abcId}"]`);
    const statusAttr = await abcRow.getAttribute('data-abc-status');
    expect(statusAttr).toBe('idle');

    const startButton = page.locator(`[data-testid="start-${abcId}"]`);
    await expect(startButton).toBeVisible();

    abcWs.close();
  });

  test('Disconnected ABC shows as offline', async ({ page }) => {
    await loginViaUI(page);

    await page.waitForFunction(
      (id: string) => {
        const el = document.querySelector(`[data-testid="abc-${id}"]`);
        return el?.getAttribute('data-abc-status') === 'offline';
      },
      abcId,
      { timeout: 15000 }
    );

    const abcRow = page.locator(`[data-testid="abc-${abcId}"]`);
    const statusAttr = await abcRow.getAttribute('data-abc-status');
    expect(statusAttr).toBe('offline');
  });
});
