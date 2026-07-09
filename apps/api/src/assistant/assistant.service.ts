import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AssistantSegmentHandoffSchema,
  resolveGlossary,
  type AssistantAnswer,
  type AssistantCitation,
} from '@crm/types';
import { Prisma } from '@prisma/client';
import type { UserContext } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { canSeeUnmaskedPii } from '../common/pii.util';
import type { Env } from '../config/env';
import { AnalyticsService } from '../analytics/analytics.service';
import { SegmentService } from '../segments/segment.service';
import { AiSafeCustomerRepository } from '../customers/ai-safe-customer.repository';
import { GroundingService } from './grounding.service';
import { AssistantOrchestrator } from './orchestrator';
import { answerCacheKey } from './assistant.constants';
import type { ToolContext } from './tools/tool.types';

/**
 * The read-only AI assistant. Answers ONLY from org data through the safe tool
 * layer, inherits the asker's RBAC role (org + PII masking), grounds every
 * metric in the glossary, is cached + cost-bounded, and audits every question.
 * It never mutates anything.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly grounding: GroundingService,
    private readonly orchestrator: AssistantOrchestrator,
    private readonly analytics: AnalyticsService,
    private readonly segments: SegmentService,
    private readonly aiSafe: AiSafeCustomerRepository,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async ask(user: UserContext, question: string): Promise<AssistantAnswer> {
    const organizationId = user.organization.id;
    const cacheKey = answerCacheKey({ organizationId, permissions: user.permissions, question });

    // 1) Cache (identical org + role-scope + question → short-TTL hit).
    const cached = await this.redis.cacheGet<AssistantAnswer>(cacheKey);
    if (cached) {
      await this.audit(user, question, cached.toolsUsed, true);
      return { ...cached, cached: true };
    }

    // 2) Ground: retrieve the glossary definitions relevant to the question.
    const glossary = await this.grounding.retrieve(question);

    // 3) Orchestrate: safe read-only tools + grounded composition, RBAC-scoped.
    const ctx: ToolContext = {
      organizationId,
      actorUserId: user.user.id,
      permissions: user.permissions,
      unmaskedPii: canSeeUnmaskedPii(user.permissions),
      prisma: this.prisma,
      analytics: this.analytics,
      segments: this.segments,
      aiSafe: this.aiSafe,
    };
    const result = await this.orchestrator.run(question, ctx, glossary);

    // 4) Citations: every metric the answer touched resolves from the ONE glossary.
    const citations = this.buildCitations(result.metricKeys);

    // 5) Validate the optional segment hand-off (must be a well-formed rule tree).
    const handoff = result.segmentHandoff
      ? AssistantSegmentHandoffSchema.safeParse(result.segmentHandoff)
      : null;

    const answer: AssistantAnswer = {
      answer: result.answer,
      citations,
      toolsUsed: result.toolsUsed,
      segmentHandoff: handoff?.success ? handoff.data : null,
      declinedAction: result.declinedAction,
      cached: false,
      answeredAt: new Date().toISOString(),
    };

    // 6) Cache (best-effort) + audit.
    const ttl = this.config.get('ASSISTANT_CACHE_TTL_SECONDS', { infer: true });
    if (ttl > 0) await this.redis.cacheSet(cacheKey, answer, ttl);
    await this.audit(user, question, result.toolsUsed, false);

    return answer;
  }

  private buildCitations(metricKeys: string[]): AssistantCitation[] {
    const seen = new Set<string>();
    const out: AssistantCitation[] = [];
    for (const key of metricKeys) {
      if (seen.has(key)) continue;
      const entry = resolveGlossary(key);
      if (!entry) continue;
      seen.add(key);
      out.push({ metricKey: entry.metricKey, plainLanguage: entry.plainLanguage, formula: entry.formula, dataWindow: entry.dataWindow });
    }
    return out;
  }

  /**
   * Audit every question: an AiQuery row (the assistant's own trail) + an
   * AuditLog row. Stores only the question + tool names/args/rowCounts — never
   * the answer text or returned customer data, so the audit can't leak PII.
   */
  private async audit(user: UserContext, question: string, toolsUsed: AssistantAnswer['toolsUsed'], cached: boolean): Promise<void> {
    try {
      await this.prisma.aiQuery.create({
        data: {
          organizationId: user.organization.id,
          actorUserId: user.user.id,
          question,
          toolsCalled: toolsUsed as unknown as Prisma.InputJsonValue,
          cached,
        },
      });
      await this.prisma.auditLog.create({
        data: {
          organizationId: user.organization.id,
          actorUserId: user.user.id,
          actorClerkUserId: user.user.clerkUserId,
          action: 'query',
          entity: 'AiQuery',
          after: { question, tools: toolsUsed.map((t) => t.tool), cached } as unknown as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.warn(`Assistant audit write failed: ${(err as Error).message}`);
    }
  }
}
