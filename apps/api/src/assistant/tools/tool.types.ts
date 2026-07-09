import type { ZodSchema } from 'zod';
import type { PrismaService } from '../../prisma/prisma.service';
import type { AnalyticsService } from '../../analytics/analytics.service';
import type { SegmentService } from '../../segments/segment.service';

/**
 * Everything a safe tool is allowed to touch. Crucially it carries the asker's
 * RBAC scope (organizationId + unmaskedPii), so every tool is org-scoped and
 * PII-masked BY CONSTRUCTION — a tool has no way to reach another org's data or
 * unmasked PII the asker couldn't otherwise see.
 */
export interface ToolContext {
  organizationId: string;
  actorUserId: string;
  permissions: string[];
  /** True only when the asker holds pii:read — decides masked vs unmasked. */
  unmaskedPii: boolean;
  prisma: PrismaService;
  analytics: AnalyticsService;
  segments: SegmentService;
}

export interface ToolResult {
  /** Structured, already-masked data the model composes the answer from. */
  data: unknown;
  /** Row/entity count touched (for the audit trail + "large result" summarizing). */
  rowCount: number | null;
  /** A rule tree the USER could build into a segment (hand-off), when relevant. */
  segmentHandoff?: { label: string; rules: unknown };
}

/**
 * A curated, whitelisted, parameterized READ-ONLY query the model may call. The
 * model NEVER writes SQL — it can only pick a tool by name and supply args that
 * we validate. There is intentionally NO mutation tool in the registry, so the
 * assistant cannot act.
 */
export interface AssistantTool {
  name: string;
  /** Shown to the model — describes when to use it (no data leaks). */
  description: string;
  /** JSON Schema for the model's tool-calling arguments. */
  inputSchema: Record<string, unknown>;
  /** Server-side validation of the model's (untrusted) arguments. */
  paramsSchema: ZodSchema;
  /** Glossary metricKeys this tool's output involves — drives citations. */
  metricKeys: string[];
  execute(ctx: ToolContext, params: unknown): Promise<ToolResult>;
}
