import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api.js';

const api = new StreamlateAPI();

test.describe('Rate Limiting', () => {
  test('exceed rate limit returns 429', async () => {
    let got429 = false;
    for (let i = 0; i < 15; i++) {
      const res = await api.loginRaw('nonexistent@example.com', 'wrong');
      if (res.status === 429) {
        got429 = true;
        break;
      }
    }
    expect(got429).toBe(true);
  });
});
