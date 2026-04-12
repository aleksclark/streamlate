import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';

const api = new StreamlateAPI();

test.describe('PIN Flow', () => {
  test.beforeAll(async () => {
    await api.waitReady(30000);
  });

  test('PIN-protected session prompts for PIN', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'admin123');
    const session = await api.createSession(token, {
      session_name: 'PIN Required Session',
      translator_name: 'Translator',
      pin: '1234',
    });

    try {
      await page.goto(`/listen/${session.id}`);
      await expect(page.getByTestId('pin-heading')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('pin-heading')).toHaveText('Enter PIN');
    } finally {
      await api.stopSession(token, session.id as string);
    }
  });

  test('wrong PIN is rejected', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'admin123');
    const session = await api.createSession(token, {
      session_name: 'Wrong PIN Test',
      translator_name: 'Translator',
      pin: '1234',
    });

    try {
      await page.goto(`/listen/${session.id}`);
      await expect(page.getByTestId('pin-heading')).toBeVisible({ timeout: 10000 });

      await page.getByTestId('pin-digit-0').fill('9');
      await page.getByTestId('pin-digit-1').fill('9');
      await page.getByTestId('pin-digit-2').fill('9');
      await page.getByTestId('pin-digit-3').fill('9');

      await expect(page.getByTestId('pin-error')).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId('pin-error')).toContainText('Incorrect PIN');
    } finally {
      await api.stopSession(token, session.id as string);
    }
  });

  test('correct PIN grants access', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'admin123');
    const session = await api.createSession(token, {
      session_name: 'Correct PIN Test',
      translator_name: 'Translator',
      pin: '4321',
    });

    try {
      await page.goto(`/listen/${session.id}`);
      await expect(page.getByTestId('pin-heading')).toBeVisible({ timeout: 10000 });

      await page.getByTestId('pin-digit-0').fill('4');
      await page.getByTestId('pin-digit-1').fill('3');
      await page.getByTestId('pin-digit-2').fill('2');
      await page.getByTestId('pin-digit-3').fill('1');

      await expect(page.getByTestId('connection-status')).toBeVisible({ timeout: 15000 });
    } finally {
      await api.stopSession(token, session.id as string);
    }
  });

  test('unprotected session skips PIN prompt', async ({ page }) => {
    const token = await api.login('admin@streamlate.local', 'admin123');
    const session = await api.createSession(token, {
      session_name: 'No PIN Session',
      translator_name: 'Translator',
    });

    try {
      await page.goto(`/listen/${session.id}`);
      await expect(page.getByTestId('pin-heading')).not.toBeVisible({ timeout: 3000 }).catch(() => {});
      await expect(page.getByTestId('connection-status')).toBeVisible({ timeout: 15000 });
    } finally {
      await api.stopSession(token, session.id as string);
    }
  });
});
