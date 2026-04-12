import { test, expect } from '@playwright/test';
import { StreamlateAPI } from '../../fixtures/api.js';

const api = new StreamlateAPI();

test.describe('Phase 8: Monitoring', () => {
  test('health check returns ok with checks object', async () => {
    const res = await fetch('http://localhost:8080/api/v1/system/health');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBeTruthy();
    expect(data.version).toBeTruthy();
    expect(typeof data.uptime_seconds).toBe('number');
    expect(data.checks).toBeTruthy();
    expect(data.checks.database).toBe('ok');
  });

  test('stats endpoint returns system statistics', async () => {
    const res = await fetch('http://localhost:8080/api/v1/system/stats');
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(typeof data.active_sessions).toBe('number');
    expect(typeof data.total_users).toBe('number');
    expect(typeof data.total_abcs).toBe('number');
    expect(typeof data.total_recordings).toBe('number');
  });

  test('metrics endpoint returns Prometheus-format text', async () => {
    const res = await fetch('http://localhost:8080/metrics');
    expect(res.status).toBe(200);
    const contentType = res.headers.get('content-type');
    expect(contentType).toContain('text/plain');

    const body = await res.text();
    expect(body).toContain('streamlate_uptime_seconds');
    expect(body).toContain('streamlate_active_sessions');
    expect(body).toContain('streamlate_connected_abcs');
    expect(body).toContain('streamlate_http_requests_total');
  });

  test('metrics counters increase after requests', async () => {
    const res1 = await fetch('http://localhost:8080/metrics');
    const body1 = await res1.text();

    await fetch('http://localhost:8080/api/v1/system/health');
    await fetch('http://localhost:8080/api/v1/system/health');
    await fetch('http://localhost:8080/api/v1/system/health');

    const res2 = await fetch('http://localhost:8080/metrics');
    const body2 = await res2.text();

    const extractTotal = (text: string): number => {
      let total = 0;
      const matches = text.matchAll(
        /streamlate_http_requests_total\{[^}]*\}\s+(\d+)/g
      );
      for (const m of matches) {
        total += parseInt(m[1], 10);
      }
      return total;
    };

    const total1 = extractTotal(body1);
    const total2 = extractTotal(body2);

    expect(total2).toBeGreaterThan(total1);
  });

  test('uptime increases over time', async () => {
    const res1 = await fetch('http://localhost:8080/api/v1/system/health');
    const data1 = await res1.json();
    const uptime1 = data1.uptime_seconds;

    await new Promise((r) => setTimeout(r, 1500));

    const res2 = await fetch('http://localhost:8080/api/v1/system/health');
    const data2 = await res2.json();
    const uptime2 = data2.uptime_seconds;

    expect(uptime2).toBeGreaterThanOrEqual(uptime1);
  });
});
