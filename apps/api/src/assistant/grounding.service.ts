import { Injectable, Logger } from '@nestjs/common';
import { GLOSSARY_REGISTRY, GLOSSARY_VERSION, resolveGlossary, type GlossaryEntry } from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { cosineSim, embedText, toPgVector } from './embeddings.util';

/**
 * Glossary grounding via pgvector. On boot the worker embeds every glossary
 * definition into `glossary_embedding`; on a question we embed the question and
 * retrieve the nearest definitions so the answer can CITE them. Retrieval
 * returns DEFINITIONS ONLY (the shared glossary) — never org/customer data — so
 * it is not RBAC-scoped.
 *
 * The pgvector path is primary; if the table is unpopulated or pgvector is
 * unavailable, we fall back to an in-memory cosine match over the same registry
 * so grounding always works (definitions are cheap to embed on the fly).
 */
@Injectable()
export class GroundingService {
  private readonly logger = new Logger(GroundingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The exact text embedded for a metric (definition + formula + window). */
  private contentFor(entry: GlossaryEntry): string {
    return `${entry.metricKey.replace(/_/g, ' ')}: ${entry.plainLanguage} ${entry.formula} ${entry.dataWindow}`;
  }

  /**
   * (Re)embed every glossary definition into pgvector. Idempotent: upserts by
   * metric_key and only rewrites when the glossary version changed. Returns the
   * number of definitions embedded.
   */
  async embedGlossary(): Promise<number> {
    const entries = Object.values(GLOSSARY_REGISTRY);
    let written = 0;
    for (const entry of entries) {
      const content = this.contentFor(entry);
      const vec = toPgVector(embedText(content));
      const id = `gloss_${entry.metricKey}`;
      try {
        await this.prisma.$executeRaw`
          INSERT INTO glossary_embedding (id, metric_key, content, glossary_version, embedding, updated_at)
          VALUES (${id}, ${entry.metricKey}, ${content}, ${GLOSSARY_VERSION}, ${vec}::vector, now())
          ON CONFLICT (metric_key) DO UPDATE SET
            content = EXCLUDED.content,
            glossary_version = EXCLUDED.glossary_version,
            embedding = EXCLUDED.embedding,
            updated_at = now()
          WHERE glossary_embedding.glossary_version <> EXCLUDED.glossary_version
             OR glossary_embedding.content <> EXCLUDED.content`;
        written += 1;
      } catch (err) {
        // pgvector missing / table absent → grounding still works via fallback.
        this.logger.warn(`embedGlossary(${entry.metricKey}) failed: ${(err as Error).message}`);
        return written;
      }
    }
    this.logger.log(`Embedded ${written} glossary definitions (v${GLOSSARY_VERSION})`);
    return written;
  }

  /**
   * Retrieve the glossary definitions most relevant to a question. Tries
   * pgvector first (cosine distance via `<=>`), falls back to in-memory cosine.
   */
  async retrieve(question: string, k = 4): Promise<GlossaryEntry[]> {
    const qvec = toPgVector(embedText(question));
    try {
      const rows = await this.prisma.$queryRaw<Array<{ metric_key: string; distance: number }>>`
        SELECT metric_key, (embedding <=> ${qvec}::vector) AS distance
        FROM glossary_embedding
        ORDER BY distance ASC
        LIMIT ${k}`;
      if (rows.length > 0) {
        return rows
          .map((r) => resolveGlossary(r.metric_key))
          .filter((e): e is GlossaryEntry => e !== null);
      }
    } catch (err) {
      this.logger.warn(`pgvector retrieve failed, using in-memory fallback: ${(err as Error).message}`);
    }
    return this.retrieveInMemory(question, k);
  }

  /** Deterministic fallback: cosine over the glossary registry, no DB needed. */
  private retrieveInMemory(question: string, k: number): GlossaryEntry[] {
    const qvec = embedText(question);
    const scored = Object.values(GLOSSARY_REGISTRY).map((entry) => ({
      entry,
      score: cosineSim(qvec, embedText(this.contentFor(entry))),
    }));
    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .filter((s) => s.score > 0)
      .map((s) => s.entry);
  }
}
