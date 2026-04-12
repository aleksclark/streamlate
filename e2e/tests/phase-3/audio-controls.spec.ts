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
  const abc = await api.createAbc(adminToken, 'Audio Controls Booth');
  abcId = abc.data.id;
  abcSecret = abc.data.secret;
});

async function loginAndStartSession(page: import('@playwright/test').Page) {
  await page.goto(`${CLIENT_URL}/login`);
  await page.fill('input#email', adminEmail);
  await page.fill('input#password', adminPassword);
  await page.click('button[type="submit"]');
  await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });

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
}

test.describe('Audio controls', () => {
  test('Source VU meter shows activity when ABC sim sends audio', async ({ page }) => {
    const { ws: abcWs } = await connectAndWaitWelcome(
      `/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`
    );

    await loginAndStartSession(page);

    const vuMeter = page.locator('[aria-label="Source audio level"]');
    await expect(vuMeter).toBeVisible();

    await page.waitForFunction(() => {
      const meter = document.querySelector('[aria-label="Source audio level"]');
      if (!meter) return false;
      const level = parseInt(meter.getAttribute('aria-valuenow') || '-60', 10);
      return level > -40;
    }, { timeout: 15000 });

    const level = await vuMeter.getAttribute('aria-valuenow');
    expect(parseInt(level!, 10)).toBeGreaterThan(-40);

    await page.click('[data-testid="end-session"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });
    abcWs.close();
  });

  test('Translation VU meter shows activity when mic is active', async ({ page }) => {
    const { ws: abcWs } = await connectAndWaitWelcome(
      `/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`
    );

    await loginAndStartSession(page);

    const vuMeter = page.locator('[aria-label="Translation audio level"]');
    await expect(vuMeter).toBeVisible();

    await page.waitForFunction(() => {
      const meter = document.querySelector('[aria-label="Translation audio level"]');
      if (!meter) return false;
      const level = parseInt(meter.getAttribute('aria-valuenow') || '-60', 10);
      return level > -55;
    }, { timeout: 15000 });

    await page.click('[data-testid="end-session"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });
    abcWs.close();
  });

  test('Mute button toggles muted state', async ({ page }) => {
    const { ws: abcWs } = await connectAndWaitWelcome(
      `/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`
    );

    await loginAndStartSession(page);

    const muteBtn = page.locator('[data-testid="mute-button"]');
    await expect(muteBtn).toBeVisible();

    let muted = await muteBtn.getAttribute('data-muted');
    expect(muted).toBe('false');

    await muteBtn.click();
    muted = await muteBtn.getAttribute('data-muted');
    expect(muted).toBe('true');

    await muteBtn.click();
    muted = await muteBtn.getAttribute('data-muted');
    expect(muted).toBe('false');

    await page.click('[data-testid="end-session"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });
    abcWs.close();
  });

  test('Passthrough button toggles passthrough state', async ({ page }) => {
    const { ws: abcWs } = await connectAndWaitWelcome(
      `/ws/abc/${abcId}?token=${encodeURIComponent(abcSecret)}`
    );

    await loginAndStartSession(page);

    const ptBtn = page.locator('[data-testid="passthrough-button"]');
    await expect(ptBtn).toBeVisible();

    let pt = await ptBtn.getAttribute('data-passthrough');
    expect(pt).toBe('false');

    await ptBtn.click();
    pt = await ptBtn.getAttribute('data-passthrough');
    expect(pt).toBe('true');

    await ptBtn.click();
    pt = await ptBtn.getAttribute('data-passthrough');
    expect(pt).toBe('false');

    await page.click('[data-testid="end-session"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });
    abcWs.close();
  });
});
