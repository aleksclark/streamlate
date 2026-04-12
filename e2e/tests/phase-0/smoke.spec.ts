import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api';

const SERVER_URL = 'http://localhost:8080';
const TRANSLATION_URL = 'http://localhost:3001';
const LISTENER_URL = 'http://localhost:3002';

const api = new StreamlateAPI(SERVER_URL);

test.describe('Phase 0: Smoke Tests', () => {
  test('server health check returns 200 with valid JSON', async () => {
    const health = await api.health();
    expect(health.status).toBe('ok');
    expect(health.version).toBeTruthy();
    expect(typeof health.version).toBe('string');
  });

  test('OpenAPI spec at /api/openapi.json parses as valid OpenAPI 3.x', async () => {
    const spec = (await api.getOpenApiSpec()) as Record<string, unknown>;
    expect(spec).toBeTruthy();
    expect(typeof spec.openapi).toBe('string');
    expect((spec.openapi as string).startsWith('3.')).toBe(true);
    expect(spec.info).toBeTruthy();
    expect(spec.paths).toBeTruthy();
  });

  test('translation client loads at :3001 without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(TRANSLATION_URL);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page.getByText('Streamlate')).toBeVisible();
    await expect(page.getByText('Translation Client')).toBeVisible();
  });

  test('listener client loads at :3002 without JS errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto(LISTENER_URL);
    await page.waitForLoadState('networkidle');

    expect(errors).toHaveLength(0);
    await expect(page.locator('body')).not.toBeEmpty();
    await expect(page.getByText('Streamlate')).toBeVisible();
    await expect(page.getByText('Listener Client')).toBeVisible();
  });

  test('ABC sim container starts without crashing', async () => {
    const res = await fetch(`${SERVER_URL}/api/v1/system/health`);
    expect(res.ok).toBe(true);
  });
});
