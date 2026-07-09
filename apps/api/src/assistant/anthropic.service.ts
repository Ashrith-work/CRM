import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';

/**
 * Thin wrapper over the Anthropic SDK. Mirrors the repo's other third-party
 * adapters (MyOperator/Cloudinary): when ANTHROPIC_API_KEY is unset it reports
 * unavailable and the orchestrator falls back to a deterministic, still-grounded
 * planner — so the whole pipeline (safe tools, RBAC, grounding, caching, audit)
 * runs and is testable without a network key.
 *
 * The SDK is imported dynamically so the module loads even if the package isn't
 * installed yet; a load/auth failure degrades to unavailable, never a crash.
 */
@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly apiKey: string | undefined;
  private client: unknown = null;
  private tried = false;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.apiKey = this.config.get('ANTHROPIC_API_KEY', { infer: true });
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  private async getClient(): Promise<{ messages: { create(params: unknown): Promise<AnthropicMessage> } } | null> {
    if (!this.apiKey) return null;
    if (this.client) return this.client as never;
    if (this.tried) return null;
    this.tried = true;
    try {
      // Non-literal specifier → not statically resolved, so this compiles even
      // before `@anthropic-ai/sdk` is installed; runtime resolves when present.
      const moduleName = '@anthropic-ai/sdk';
      const mod: { default?: new (o: unknown) => unknown; Anthropic?: new (o: unknown) => unknown } = await import(moduleName);
      const Ctor = mod.default ?? mod.Anthropic;
      if (!Ctor) throw new Error('Anthropic SDK export not found');
      this.client = new Ctor({ apiKey: this.apiKey });
      return this.client as never;
    } catch (err) {
      this.logger.warn(`Anthropic SDK unavailable, using deterministic fallback: ${(err as Error).message}`);
      return null;
    }
  }

  /** Create a message. Returns null if the client is unavailable (→ fallback). */
  async createMessage(params: AnthropicCreateParams): Promise<AnthropicMessage | null> {
    const client = await this.getClient();
    if (!client) return null;
    try {
      return await client.messages.create(params);
    } catch (err) {
      this.logger.error(`Anthropic request failed: ${(err as Error).message}`);
      return null;
    }
  }
}

// Minimal shapes we rely on (kept local so we don't depend on the SDK's types).
export interface AnthropicCreateParams {
  model: string;
  max_tokens: number;
  system?: string;
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  tool_choice?: { type: 'auto' | 'none' | 'any' };
  messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
}

export interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
}

export interface AnthropicMessage {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
}
