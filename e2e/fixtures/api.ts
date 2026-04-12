export interface HealthResponse {
  status: string;
  version: string;
}

export class StreamlateAPI {
  constructor(private baseUrl: string) {}

  async health(): Promise<HealthResponse> {
    const res = await fetch(`${this.baseUrl}/api/v1/system/health`);
    if (!res.ok) throw new Error(`Health check failed: ${res.status}`);
    return res.json();
  }

  async waitReady(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        await this.health();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    throw new Error(`Server not ready within ${timeoutMs}ms`);
  }

  async login(_email: string, _password: string): Promise<string> {
    throw new Error('Not implemented in phase 0');
  }

  async createUser(_token: string, _user: unknown): Promise<unknown> {
    throw new Error('Not implemented in phase 0');
  }

  async registerABC(_token: string, _name: string): Promise<unknown> {
    throw new Error('Not implemented in phase 0');
  }

  async createSession(_token: string, _abcId: string, _name: string): Promise<unknown> {
    throw new Error('Not implemented in phase 0');
  }

  async stopSession(_token: string, _sessionId: string): Promise<void> {
    throw new Error('Not implemented in phase 0');
  }

  async getOpenApiSpec(): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}/api/openapi.json`);
    if (!res.ok) throw new Error(`OpenAPI spec fetch failed: ${res.status}`);
    return res.json();
  }
}
