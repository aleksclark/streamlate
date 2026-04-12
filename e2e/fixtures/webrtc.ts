import { type Page, expect } from '@playwright/test';

export async function assertWebRTCConnected(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const pcs = (window as unknown as Record<string, RTCPeerConnection[]>).__rtcPeerConnections;
      if (!pcs || pcs.length === 0) return false;
      return pcs.some((pc) => pc.connectionState === 'connected');
    },
    { timeout: timeoutMs }
  );
}

export async function assertWebRTCDisconnected(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const pcs = (window as unknown as Record<string, RTCPeerConnection[]>).__rtcPeerConnections;
      if (!pcs || pcs.length === 0) return true;
      return pcs.every(
        (pc) => pc.connectionState === 'closed' || pc.connectionState === 'disconnected'
      );
    },
    { timeout: timeoutMs }
  );
}

export async function getWebRTCStats(
  page: Page
): Promise<{ bytesReceived: number; bytesSent: number }> {
  return page.evaluate(async () => {
    const pcs = (window as unknown as Record<string, RTCPeerConnection[]>).__rtcPeerConnections;
    if (!pcs || pcs.length === 0) return { bytesReceived: 0, bytesSent: 0 };

    let totalReceived = 0;
    let totalSent = 0;
    for (const pc of pcs) {
      const stats = await pc.getStats();
      stats.forEach((report) => {
        if (report.type === 'inbound-rtp') totalReceived += report.bytesReceived ?? 0;
        if (report.type === 'outbound-rtp') totalSent += report.bytesSent ?? 0;
      });
    }
    return { bytesReceived: totalReceived, bytesSent: totalSent };
  });
}

void expect;
