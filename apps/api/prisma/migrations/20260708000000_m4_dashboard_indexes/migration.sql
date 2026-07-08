-- Milestone 4 — indexes only (no schema/table changes) to keep the read-only
-- dashboard aggregates fast.

-- CreateIndex
CREATE INDEX "Deal_organizationId_status_closedAt_idx" ON "Deal"("organizationId", "status", "closedAt");

-- CreateIndex
CREATE INDEX "Deal_organizationId_createdAt_idx" ON "Deal"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ActivityEvent_organizationId_actorId_createdAt_idx" ON "ActivityEvent"("organizationId", "actorId", "createdAt");

-- CreateIndex
CREATE INDEX "Task_organizationId_assigneeId_completedAt_idx" ON "Task"("organizationId", "assigneeId", "completedAt");
