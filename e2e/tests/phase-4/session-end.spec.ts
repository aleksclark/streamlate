import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';

const api = new StreamlateAPI();

test.describe('Session End', () => {
  test.beforeAll(async () => {
    await api.waitReady(30000);
  });

  test('translator ends session → listener sees "session ended" text', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'admin123');
    const session = await api.createSession(token, {
      session_name: 'Session End Test',
      translator_name: 'Translator',
    });

    await page.goto(`/listen/${session.id}`);
    await expect(page.getByTestId('connection-status-text')).toHaveText('Connected', { timeout: 20000 });

    await api.stopSession(token, session.id as string);

    await expect(page.getByTestId('session-ended-message')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('session-ended-message')).toContainText('session has ended');
    await expect(page.getByTestId('back-to-sessions')).toBeVisible();
  });

  test('ended session shows back-to-sessions button that navigates correctly', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'admin123');
    const session = await api.createSession(token, {
      session_name: 'End Nav Test',
      translator_name: 'Translator',
    });

    await page.goto(`/listen/${session.id}`);
    await expect(page.getByTestId('connection-status-text')).toHaveText('Connected', { timeout: 20000 });

    await api.stopSession(token, session.id as string);

    await expect(page.getByTestId('back-to-sessions')).toBeVisible({ timeout: 10000 });
    await page.getByTestId('back-to-sessions').click();
    await expect(page).toHaveURL('/listen');
  });

  test('navigating to completed session shows session ended', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'admin123');
    const session = await api.createSession(token, {
      session_name: 'Already Ended',
      translator_name: 'Translator',
    });
    await api.stopSession(token, session.id as string);

    await page.goto(`/listen/${session.id}`);
    await expect(page.getByTestId('session-ended-message')).toBeVisible({ timeout: 10000 });
  });
});
