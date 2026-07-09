# P2.2 — Read-only AI Assistant · Assumptions & Notes

## What was built
- **Safe read-only tool layer** (`tools/query.tools.ts`): 10 curated, whitelisted,
  parameterized query functions. The model never writes SQL — it picks a tool by
  name and supplies args we validate with Zod. Every tool is org-scoped and
  PII-masked **by construction** (via `ToolContext.organizationId` /
  `unmaskedPii`). There is **no mutation tool** in the registry, so the assistant
  cannot act. Filter-based tools reuse M3's `translateRules` (whitelisted
  field/op → structured Prisma `where`, never string-concatenated).
- **Glossary grounding** (`grounding.service.ts` + `embed-glossary.processor.ts`):
  glossary definitions are embedded into a pgvector table (`glossary_embedding`)
  on boot + daily; a question is embedded and the nearest definitions retrieved
  so the answer cites them. Retrieval returns **definitions only**, never org
  data, so it is not RBAC-scoped.
- **LLM orchestrator** (`orchestrator.ts`): a read-only tool-calling loop on the
  cheap routing model (Haiku) gathers data via the safe tools, then the stronger
  model (Opus 4.8, adaptive thinking, capped `max_tokens`) composes a grounded
  answer. All returned customer data is marked **untrusted** in the prompt
  (prompt-injection defense); the answer comes **only** from tool data
  (anti-hallucination → "I don't have data on that"); action requests are
  declined with a segment hand-off.
- **Caching + cost bounds** (`assistant.constants.ts`, Redis): identical
  `(org, role-scope, question)` → short-TTL cache hit; output tokens capped;
  tool steps capped; two-tier model routing.
- **Audit** (`assistant.service.ts`): every question writes an `AiQuery` **and**
  an `AuditLog` row — storing only the question + tool names/args/rowCounts,
  never the answer text or returned customer data (so the audit can't leak PII).
- **UI** (`apps/web/.../assistant/page.tsx`): chat panel under "Understand → Ask"
  with grounded answers, inline definitions, "build segment from this" hand-off,
  and loading/empty/error/declined/cached states.

## Assumptions
1. **Embeddings are local + deterministic.** Anthropic has no embeddings
   endpoint, and the glossary is tiny (~15 entries), so `embeddings.util.ts` is a
   hashed bag-of-tokens embedder (256-dim, unit vectors). It needs no extra API
   key, works offline, and keeps tests + cache keys stable. It sits behind one
   function so a real vendor (e.g. Voyage) can be swapped in — keep
   `EMBEDDING_DIM` in sync with the migration's `vector(N)`.
2. **MOCK / fallback mode.** With `ANTHROPIC_API_KEY` unset, the orchestrator
   runs a deterministic, still-grounded planner (keyword-route to safe tools →
   templated answer). This mirrors the repo's other adapters (MyOperator/
   Cloudinary MOCK) so the whole pipeline — safe tools, RBAC, grounding, caching,
   audit — runs and is fully testable without a key/network. The `@anthropic-ai/
   sdk` is loaded via a dynamic import so the module compiles/loads even before
   the package is installed.
3. **`ai:query` permission.** Added to `owner` (via ALL), `admin`, and `member`.
   As with every prior milestone's new permission, **existing orgs must be
   re-seeded** to grant it (`pnpm db:seed`); fresh orgs get it automatically. A
   lower-privilege asker inheriting no `pii:read` proves masked answers.
4. **`glossary_embedding` is an unmanaged raw table** (like the repo's existing
   materialized views `customer_rfm` / `revenue_daily` / …). It is created in the
   migration, not modeled in Prisma, and read/written via `$queryRaw`. Avoid
   `prisma migrate dev` reset assumptions; use `migrate deploy` in prod.
5. **pgvector must be enabled.** The migration runs `CREATE EXTENSION IF NOT
   EXISTS vector`. If the extension isn't installed on the Postgres image,
   `embedGlossary` degrades to the in-memory retrieval fallback (logged, not
   fatal) — grounding still works.
6. **Env additions** (`config/env.ts`): `ANTHROPIC_API_KEY` (optional),
   `ASSISTANT_ROUTING_MODEL` (haiku), `ASSISTANT_COMPOSER_MODEL` (opus-4-8),
   `ASSISTANT_MAX_OUTPUT_TOKENS`, `ASSISTANT_MAX_TOOL_STEPS`,
   `ASSISTANT_CACHE_TTL_SECONDS`. A spend alert should be configured in the
   Anthropic Console (out of band, per CLAUDE.md).

## Tests (security-heavy, all green — 27 unit tests, no DB/network needed)
- RBAC/PII masking follows the asker's role; queries never escape the org;
  no mutation tool exists; rule-tree rejects non-whitelisted fields.
- Grounding cites the right glossary definitions; degrades without pgvector.
- Read-only: action requests declined; unsupported questions → honest "no data".
- Prompt-injection: an instruction embedded in a customer name is ignored.
- Cost: repeated question hits cache without re-running the orchestrator; cache
  keys isolate orgs **and** roles (a member never shares an admin's entry).

## Not done (per NON-GOALS)
No actions/mutations, no call transcription, no campaign-copy generation, no
free-form SQL, no mobile.
