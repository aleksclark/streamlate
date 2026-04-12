import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';
import { getAdminPassword } from '../../fixtures/ws-helpers';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const CLIENT_URL = process.env.TRANSLATION_CLIENT_URL || 'http://localhost:3001';

let api: StreamlateAPI;
let adminEmail: string;
let adminPassword: string;

test.beforeAll(async () => {
  api = new StreamlateAPI(BASE_URL);
  await api.waitReady(30000);
  adminEmail = 'admin@streamlate.local';
  adminPassword = await getAdminPassword(api);
});

test.describe('Login flow', () => {
  test('Login form submits, dashboard appears', async ({ page }) => {
    await page.goto(CLIENT_URL);
    await page.waitForURL(/\/login/);

    await page.fill('input#email', adminEmail);
    await page.fill('input#password', adminPassword);
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });
    expect(await page.isVisible('[data-testid="dashboard"]')).toBe(true);
  });

  test('Login with wrong password shows error', async ({ page }) => {
    await page.goto(`${CLIENT_URL}/login`);

    await page.fill('input#email', adminEmail);
    await page.fill('input#password', 'wrong-password-123');
    await page.click('button[type="submit"]');

    await page.waitForSelector('[data-testid="login-error"]', { timeout: 5000 });
    const errorText = await page.textContent('[data-testid="login-error"]');
    expect(errorText).toBeTruthy();
    expect(errorText!.length).toBeGreaterThan(0);
  });

  test('Protected route redirects to login when not authenticated', async ({ page }) => {
    await page.goto(CLIENT_URL);
    await page.waitForURL(/\/login/, { timeout: 10000 });
  });

  test('Logout returns to login', async ({ page }) => {
    await page.goto(`${CLIENT_URL}/login`);
    await page.fill('input#email', adminEmail);
    await page.fill('input#password', adminPassword);
    await page.click('button[type="submit"]');
    await page.waitForSelector('[data-testid="dashboard"]', { timeout: 10000 });

    await page.click('[data-testid="logout-button"]');
    await page.waitForURL(/\/login/, { timeout: 5000 });
  });
});
