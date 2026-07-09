-- P2.2 — read-only AI assistant.

-- 1) AiQuery: the assistant's own audit trail (one row per question asked).
CREATE TABLE "AiQuery" (
    "id"             TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "actorUserId"    TEXT NOT NULL,
    "question"       TEXT NOT NULL,
    "toolsCalled"    JSONB NOT NULL,
    "cached"         BOOLEAN NOT NULL DEFAULT false,
    "answeredAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiQuery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiQuery_organizationId_answeredAt_idx" ON "AiQuery" ("organizationId", "answeredAt");
CREATE INDEX "AiQuery_organizationId_actorUserId_idx" ON "AiQuery" ("organizationId", "actorUserId");

ALTER TABLE "AiQuery"
  ADD CONSTRAINT "AiQuery_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- 2) pgvector glossary grounding.
-- The glossary is the ONE source of truth for what a metric means — it is
-- SHARED across orgs (a definition is not org data), so these embeddings are
-- global, not tenant-scoped. On a question the grounding layer embeds the
-- question and retrieves the nearest definitions so the answer can CITE them.
-- Retrieval returns DEFINITIONS ONLY, never a customer's data.
-- ===========================================================================
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "glossary_embedding" (
    "id"               TEXT NOT NULL,
    "metric_key"       TEXT NOT NULL,
    -- The exact text that was embedded (definition + formula + data window).
    "content"          TEXT NOT NULL,
    -- GLOSSARY_VERSION at embed time, so a bumped glossary re-embeds cleanly.
    "glossary_version" INTEGER NOT NULL,
    -- 256-dim unit vector from the pluggable embedder (see embeddings.util.ts).
    "embedding"        vector(256) NOT NULL,
    "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "glossary_embedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "glossary_embedding_metric_key_idx" ON "glossary_embedding" ("metric_key");

-- No ivfflat/hnsw index: the glossary is tiny (~15 rows) so a cosine seq-scan is
-- faster than an approximate index and needs no training data. Add one here if
-- the embedded corpus ever grows large (e.g. field/schema descriptions).
