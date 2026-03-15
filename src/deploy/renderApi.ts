const RENDER_API_BASE = 'https://api.render.com/v1';

/** Thrown when the selected plan requires payment. */
export class RenderPaymentError extends Error {
  constructor() {
    super('This Render plan requires payment.');
    this.name = 'RenderPaymentError';
  }
}

/** Thrown when Render can't access the GitHub repo (GitHub App not installed). */
export class RenderGitHubAccessError extends Error {
  constructor(repoUrl: string) {
    super(`Render cannot access ${repoUrl}. Connect GitHub to Render first.`);
    this.name = 'RenderGitHubAccessError';
  }
}

interface RenderOwner {
  owner: { id: string; name: string; email: string; type: string };
}

interface RenderService {
  id: string;
  name: string;
  slug: string;
  existed: boolean;
  serviceDetails?: { url?: string };
}

interface RenderDeploy {
  id: string;
  status: string;
}

export interface EnvVar { key: string; value: string; }

export interface CreateServiceParams {
  name: string;
  ownerId: string;
  repoUrl: string;
  type: string;
  buildCommand: string;
  startCommand: string;
  plan?: string;
  envVars?: EnvVar[];
}

export class RenderClient {
  constructor(private readonly apiKey: string) {}

  private async request<T>(method: string, endpoint: string, body?: unknown): Promise<T> {
    const res = await fetch(`${RENDER_API_BASE}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      if (res.status === 402) throw new RenderPaymentError();
      if (res.status === 400 && text.includes('invalid or unfetchable')) {
        const repoMatch = text.match(/https:\/\/github\.com\/[^\s"]+/);
        throw new RenderGitHubAccessError(repoMatch?.[0] ?? 'your GitHub repo');
      }
      throw new Error(`Render API error ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  async getOwnerId(): Promise<string> {
    const owners = await this.request<RenderOwner[]>('GET', '/owners?limit=1');
    if (!owners[0]) {
      throw new Error('No Render owner found. Make sure your API key is valid.');
    }
    return owners[0].owner.id;
  }

  async findService(name: string, ownerId: string): Promise<(RenderService & { existed: boolean }) | null> {
    const services = await this.request<{ service: RenderService }[]>(
      'GET',
      `/services?ownerId=${ownerId}&limit=100`
    );
    const match = services.find((s) => s.service.name === name);
    if (!match) return null;
    return { ...match.service, existed: true };
  }

  private defaultBuildCommand(type: string): string {
    const defaults: Record<string, string> = {
      node: 'npm install',
      python: 'pip install -r requirements.txt',
      go: 'go build -o app .',
    };
    return defaults[type] ?? 'echo build';
  }

  async createService(params: CreateServiceParams): Promise<RenderService & { existed: boolean }> {
    const serviceType = params.type === 'static' ? 'static_site' : 'web_service';

    const body: Record<string, unknown> = {
      type: serviceType,
      name: params.name,
      ownerId: params.ownerId,
      repo: params.repoUrl.replace(/\.git$/, ''),
      branch: 'main',
      autoDeploy: 'yes',
    };

    if (serviceType === 'web_service') {
      const runtime = params.type === 'go' ? 'go'
        : params.type === 'python' ? 'python'
        : 'node';
      const buildCommand = params.buildCommand || this.defaultBuildCommand(params.type);
      body['serviceDetails'] = {
        runtime,
        plan: params.plan ?? 'free',
        region: 'oregon',
        numInstances: 1,
        envSpecificDetails: {
          buildCommand,
          startCommand: params.startCommand || undefined,
          preDeployCommand: null,
        },
      };
    } else {
      // static_site: only send buildCommand if present; publishPath defaults to root for plain HTML
      const staticDetails: Record<string, unknown> = {
        publishPath: params.buildCommand ? './dist' : '.',
      };
      if (params.buildCommand) staticDetails['buildCommand'] = params.buildCommand;
      body['serviceDetails'] = staticDetails;
    }

    if (params.envVars && params.envVars.length > 0) {
      body['envVars'] = params.envVars.map(({ key, value }) => ({ key, value }));
    }

    const result = await this.request<{ service: RenderService }>('POST', '/services', body);
    return { ...result.service, existed: false };
  }

  async findOrCreateService(params: CreateServiceParams): Promise<RenderService & { existed: boolean }> {
    const existing = await this.findService(params.name, params.ownerId);
    if (existing) return existing;
    return this.createService(params);
  }

  async triggerDeploy(serviceId: string): Promise<RenderDeploy> {
    return this.request<RenderDeploy>('POST', `/services/${serviceId}/deploys`, { clearCache: 'do_not_clear' });
  }
}
