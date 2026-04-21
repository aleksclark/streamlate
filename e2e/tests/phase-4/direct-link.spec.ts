import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';

const api = new StreamlateAPI();

test.describe('Direct Link', () => {
  test.beforeAll(async () => {
    await api.waitReady(30000);
  });

  test('direct link /listen/{id} connects without session picker', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'password');
    const session = await api.createSession(token, {
      session_name: 'Direct Link Test',
      translator_name: 'Test Translator',
    });

    try {
      await page.goto(`/listen/${session.id}`);
      await expect(page.getByTestId('connection-status')).toBeVisible({ timeout: 15000 });
      await expect(page.getByTestId('page-title')).toContainText('Direct Link Test');
    } finally {
      await api.stopSession(token, session.id as string);
    }
  });

  test('invalid session ID shows error', async ({ page }) => {
    await page.goto('/listen/nonexistent-session-id');
    await expect(page.getByTestId('error-message')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('back-button')).toBeVisible();
  });

  test('direct link with PIN in query string auto-connects', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'password');
    const session = await api.createSession(token, {
      session_name: 'PIN Direct Test',
      translator_name: 'Test',
      pin: '5678',
    });

    try {
      await page.goto(`/listen/${session.id}?pin=5678`);
      await expect(page.getByTestId('connection-status')).toBeVisible({ timeout: 15000 });
    } finally {
      await api.stopSession(token, session.id as string);
    }
  });
});
