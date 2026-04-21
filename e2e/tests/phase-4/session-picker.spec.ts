import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';

const api = new StreamlateAPI();

test.describe('Session Picker', () => {
  test.beforeAll(async () => {
    await api.waitReady(30000);
  });

  test('shows "no active sessions" when none exist', async ({ page }) => {
    await page.goto('/listen');
    await expect(page.getByTestId('picker-heading')).toBeVisible();
    await expect(page.getByTestId('picker-heading')).toHaveText('Select a session to listen:');
  });

  test('lists active session with correct name and translator', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'password');
    const session = await api.createSession(token, {
      session_name: 'Main Hall — Spanish',
      translator_name: 'Maria Rodriguez',
    });

    try {
      await page.goto('/listen');
      await expect(page.getByTestId('session-card')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('session-name').first()).toHaveText('Main Hall — Spanish');
      await expect(page.getByTestId('translator-name').first()).toHaveText('Maria Rodriguez');
      await expect(page.getByTestId('listen-button').first()).toBeVisible();
    } finally {
      await api.stopSession(token, session.id as string);
    }
  });

  test('shows lock icon for PIN-protected sessions', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'password');
    const session = await api.createSession(token, {
      session_name: 'Protected Session',
      translator_name: 'Jean D.',
      pin: '1234',
    });

    try {
      await page.goto('/listen');
      await expect(page.getByTestId('session-card')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('pin-icon')).toBeVisible();
    } finally {
      await api.stopSession(token, session.id as string);
    }
  });

  test('listen button navigates to session page', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'password');
    const session = await api.createSession(token, {
      session_name: 'Navigate Test',
      translator_name: 'Test User',
    });

    try {
      await page.goto('/listen');
      await expect(page.getByTestId('listen-button').first()).toBeVisible({ timeout: 10000 });
      await page.getByTestId('listen-button').first().click();
      await expect(page).toHaveURL(new RegExp(`/listen/${session.id}`));
    } finally {
      await api.stopSession(token, session.id as string);
    }
  });
});
