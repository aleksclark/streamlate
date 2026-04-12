import WebSocket from 'ws';
import { execSync } from 'child_process';
import { StreamlateAPI } from './api';

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';
const WS_URL = BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://');

export async function getAdminPassword(api: StreamlateAPI): Promise<string> {
  if (process.env.ADMIN_PASSWORD) {
    return process.env.ADMIN_PASSWORD;
  }
  const logs = execSync(
    'docker compose -f e2e/docker-compose.yml logs server 2>&1',
    { cwd: process.env.PROJECT_ROOT || '..', encoding: 'utf-8' }
  );
  const match = logs.match(/Password:\s+(\S+)/);
  if (match) return match[1];
  throw new Error(
    'Cannot determine admin password. Set ADMIN_PASSWORD env var or check server logs.'
  );
}

/**
 * Login as admin, retrying on 429 (rate-limit) with exponential backoff.
 * Use this instead of raw api.login() in beforeAll blocks that might run
 * after the rate-limit test.
 */
export async function adminLogin(
  api: StreamlateAPI,
  maxRetries = 10,
  initialDelayMs = 2000
): Promise<{ token: string; password: string }> {
  const password = await getAdminPassword(api);
  let delay = initialDelayMs;
  for (let i = 0; i < maxRetries; i++) {
    const res = await api.loginRaw('admin@streamlate.local', password);
    if (res.status === 200) {
      const data = await res.json() as { access_token: string };
      return { token: data.access_token, password };
    }
    if (res.status === 429 || res.status === 401) {
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 1.5, 10000);
      continue;
    }
    throw new Error(`Login failed with status ${res.status}`);
  }
  throw new Error(`Admin login failed after ${maxRetries} retries (rate-limited)`);
}

export function connectWs(path: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_URL}${path}`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    setTimeout(() => reject(new Error('WebSocket connect timeout')), 10000);
  });
}

export async function connectAndWaitWelcome(path: string): Promise<{ ws: WebSocket; welcome: Record<string, unknown> }> {
  const ws = await connectWs(path);
  const welcome = await waitForMessage(ws, 'welcome');
  await new Promise((r) => setTimeout(r, 100));
  return { ws, welcome };
}

export function waitForMessage(
  ws: WebSocket,
  type: string,
  timeoutMs = 10000
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timeout waiting for "${type}" message`)),
      timeoutMs
    );
    const handler = (data: WebSocket.Data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === type) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(msg);
      }
    };
    ws.on('message', handler);
  });
}
