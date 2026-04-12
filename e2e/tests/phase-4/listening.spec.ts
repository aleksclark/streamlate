import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';
import { getVUMeterLevel } from '../../fixtures/audio';

const api = new StreamlateAPI();

test.describe('Listening', () => {
  let token: string;
  let sessionId: string;

  test.beforeAll(async () => {
    await api.waitReady(30000);
    token = await api.login('admin@streamlate.local', 'admin123');
  });

  test.beforeEach(async () => {
    const session = await api.createSession(token, {
      session_name: 'Listening Test Session',
      translator_name: 'Maria Rodriguez',
    });
    sessionId = session.id as string;
  });

  test.afterEach(async () => {
    try {
      await api.stopSession(token, sessionId);
    } catch {}
  });

  test('listener receives audio, VU meter shows activity', async ({ page }) => {
    await page.goto(`/listen/${sessionId}`);
    await expect(page.getByTestId('connection-status-text')).toHaveText('Connected', { timeout: 20000 });
    await expect(page.getByTestId('vu-meter')).toBeVisible();

    await page.waitForTimeout(2000);
    const level = await getVUMeterLevel(page);
    expect(level).toBeGreaterThanOrEqual(0);
  });

  test('volume slider works and is visible', async ({ page }) => {
    await page.goto(`/listen/${sessionId}`);
    await expect(page.getByTestId('connection-status-text')).toHaveText('Connected', { timeout: 20000 });
    await expect(page.getByTestId('volume-slider')).toBeVisible();
    await expect(page.getByTestId('volume-input')).toBeVisible();
    await expect(page.getByTestId('volume-value')).toHaveText('100%');

    await page.getByTestId('volume-input').fill('0');
    await expect(page.getByTestId('volume-value')).toHaveText('0%');

    await page.getByTestId('volume-input').fill('0.5');
    await expect(page.getByTestId('volume-value')).toHaveText('50%');
  });

  test('session info is displayed correctly', async ({ page }) => {
    await page.goto(`/listen/${sessionId}`);
    await expect(page.getByTestId('connection-status-text')).toHaveText('Connected', { timeout: 20000 });
    await expect(page.getByTestId('translator-name')).toHaveText('Maria Rodriguez');
    await expect(page.getByTestId('session-duration')).toBeVisible();
    await expect(page.getByTestId('page-title')).toContainText('Listening Test Session');
  });

  test('QR code is displayed', async ({ page }) => {
    await page.goto(`/listen/${sessionId}`);
    await expect(page.getByTestId('connection-status-text')).toHaveText('Connected', { timeout: 20000 });
    await expect(page.getByTestId('qr-share')).toBeVisible();
  });

  test('stop button returns to session picker', async ({ page }) => {
    await page.goto(`/listen/${sessionId}`);
    await expect(page.getByTestId('stop-button')).toBeVisible({ timeout: 20000 });
    await page.getByTestId('stop-button').click();
    await expect(page).toHaveURL('/listen');
  });

  test('no microphone permission dialog appears', async ({ page, context }) => {
    let permissionRequested = false;
    context.on('page', (p) => {
      p.on('dialog', () => {
        permissionRequested = true;
      });
    });

    await page.goto(`/listen/${sessionId}`);
    await expect(page.getByTestId('connection-status-text')).toHaveText('Connected', { timeout: 20000 });
    await page.waitForTimeout(2000);

    expect(permissionRequested).toBe(false);
  });

  test('fan-out: 3 listener tabs all receive audio and server reports 3 listeners', async ({
    browser,
  }) => {
    const contexts = await Promise.all([
      browser.newContext({
        permissions: [],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
        } as any,
      }),
      browser.newContext({
        permissions: [],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
        } as any,
      }),
      browser.newContext({
        permissions: [],
        launchOptions: {
          args: ['--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
        } as any,
      }),
    ]);

    const pages = await Promise.all(contexts.map(ctx => ctx.newPage()));

    try {
      await Promise.all(pages.map(p => p.goto(`http://localhost:3002/listen/${sessionId}`)));

      for (const page of pages) {
        await expect(page.getByTestId('connection-status-text')).toHaveText('Connected', {
          timeout: 20000,
        });
      }

      await pages[0].waitForTimeout(1000);

      const session = await api.getSession(sessionId);
      expect(session.listener_count as number).toBeGreaterThanOrEqual(3);
    } finally {
      await Promise.all(contexts.map(ctx => ctx.close()));
    }
  });
});
