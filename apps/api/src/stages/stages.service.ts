import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateStageInput,
  ReorderStagesInput,
  Stage as StageDto,
  UpdateStageInput,
} from '@crm/types';
import type { Stage as StageRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class StagesService {
  constructor(private readonly prisma: PrismaService) {}

  async listForPipeline(organizationId: string, pipelineId: string): Promise<StageDto[]> {
    const stages = await this.prisma.stage.findMany({
      where: { organizationId, pipelineId, deletedAt: null },
      orderBy: { position: 'asc' },
    });
    return stages.map(serializeStage);
  }

  async create(organizationId: string, input: CreateStageInput): Promise<StageDto> {
    await this.requirePipeline(organizationId, input.pipelineId);
    const position = input.position ?? (await this.nextPosition(organizationId, input.pipelineId));
    const stage = await this.prisma.stage.create({
      data: {
        organizationId,
        pipelineId: input.pipelineId,
        name: input.name,
        position,
        probability: input.probability ?? 0,
        type: input.type ?? 'OPEN',
      },
    });
    return serializeStage(stage);
  }

  async update(organizationId: string, id: string, input: UpdateStageInput): Promise<StageDto> {
    await this.requireStage(organizationId, id);
    const stage = await this.prisma.stage.update({
      where: { id },
      data: {
        name: input.name,
        position: input.position,
        probability: input.probability,
        type: input.type,
      },
    });
    return serializeStage(stage);
  }

  /** Block deletion while the stage still holds deals (require reassignment). */
  async remove(organizationId: string, id: string): Promise<void> {
    const stage = await this.requireStage(organizationId, id);
    const deals = await this.prisma.deal.count({
      where: { organizationId, stageId: id, deletedAt: null },
    });
    if (deals > 0) {
      throw new ConflictException(
        `Stage holds ${deals} deal(s); reassign them before deleting the stage`,
      );
    }
    await this.prisma.stage.update({ where: { id }, data: { deletedAt: new Date() } });
    await this.compactPositions(organizationId, stage.pipelineId);
  }

  /** Rewrite positions to the given order; keeps them contiguous (0..n-1). */
  async reorder(organizationId: string, input: ReorderStagesInput): Promise<StageDto[]> {
    const stages = await this.prisma.stage.findMany({
      where: { organizationId, pipelineId: input.pipelineId, deletedAt: null },
      select: { id: true },
    });
    const known = new Set(stages.map((s) => s.id));
    if (input.stageIds.length !== known.size || !input.stageIds.every((id) => known.has(id))) {
      throw new ConflictException('stageIds must be exactly the pipeline’s current stages');
    }
    await this.prisma.$transaction(
      input.stageIds.map((id, index) =>
        this.prisma.stage.update({ where: { id }, data: { position: index } }),
      ),
    );
    return this.listForPipeline(organizationId, input.pipelineId);
  }

  private async nextPosition(organizationId: string, pipelineId: string): Promise<number> {
    const last = await this.prisma.stage.findFirst({
      where: { organizationId, pipelineId, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (last?.position ?? -1) + 1;
  }

  private async compactPositions(organizationId: string, pipelineId: string): Promise<void> {
    const stages = await this.prisma.stage.findMany({
      where: { organizationId, pipelineId, deletedAt: null },
      orderBy: { position: 'asc' },
      select: { id: true },
    });
    await this.prisma.$transaction(
      stages.map((s, index) =>
        this.prisma.stage.update({ where: { id: s.id }, data: { position: index } }),
      ),
    );
  }

  private async requireStage(organizationId: string, id: string): Promise<StageRow> {
    const stage = await this.prisma.stage.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!stage) throw new NotFoundException('Stage not found');
    return stage;
  }

  private async requirePipeline(organizationId: string, pipelineId: string): Promise<void> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id: pipelineId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!pipeline) throw new NotFoundException('Pipeline not found');
  }
}

export function serializeStage(stage: StageRow): StageDto {
  return {
    id: stage.id,
    organizationId: stage.organizationId,
    pipelineId: stage.pipelineId,
    name: stage.name,
    position: stage.position,
    probability: stage.probability,
    type: stage.type,
    createdAt: stage.createdAt.toISOString(),
    updatedAt: stage.updatedAt.toISOString(),
  };
}
