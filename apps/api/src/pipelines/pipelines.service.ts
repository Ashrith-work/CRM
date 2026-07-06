import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreatePipelineInput,
  Pipeline as PipelineDto,
  UpdatePipelineInput,
} from '@crm/types';
import type { Pipeline as PipelineRow, Stage as StageRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { serializeStage } from '../stages/stages.service';

const INCLUDE_STAGES = {
  stages: { where: { deletedAt: null }, orderBy: { position: 'asc' } },
} as const;

@Injectable()
export class PipelinesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<PipelineDto[]> {
    const pipelines = await this.prisma.pipeline.findMany({
      where: { organizationId, deletedAt: null },
      include: INCLUDE_STAGES,
      orderBy: { position: 'asc' },
    });
    return pipelines.map(serializePipeline);
  }

  async get(organizationId: string, id: string): Promise<PipelineDto> {
    const pipeline = await this.requirePipeline(organizationId, id);
    return serializePipeline(pipeline);
  }

  async create(organizationId: string, input: CreatePipelineInput): Promise<PipelineDto> {
    const position = input.position ?? (await this.nextPosition(organizationId));
    const pipeline = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.pipeline.updateMany({ where: { organizationId }, data: { isDefault: false } });
      }
      return tx.pipeline.create({
        data: {
          organizationId,
          name: input.name,
          isDefault: input.isDefault ?? false,
          position,
        },
        include: INCLUDE_STAGES,
      });
    });
    return serializePipeline(pipeline);
  }

  async update(organizationId: string, id: string, input: UpdatePipelineInput): Promise<PipelineDto> {
    await this.requirePipeline(organizationId, id);
    const pipeline = await this.prisma.$transaction(async (tx) => {
      if (input.isDefault) {
        await tx.pipeline.updateMany({
          where: { organizationId, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.pipeline.update({
        where: { id },
        data: { name: input.name, isDefault: input.isDefault, position: input.position },
        include: INCLUDE_STAGES,
      });
    });
    return serializePipeline(pipeline);
  }

  /** Block deletion while the pipeline still holds deals. */
  async remove(organizationId: string, id: string): Promise<void> {
    await this.requirePipeline(organizationId, id);
    const deals = await this.prisma.deal.count({
      where: { organizationId, pipelineId: id, deletedAt: null },
    });
    if (deals > 0) {
      throw new ConflictException(
        `Pipeline holds ${deals} deal(s); move or delete them before deleting the pipeline`,
      );
    }
    await this.prisma.$transaction([
      this.prisma.stage.updateMany({ where: { organizationId, pipelineId: id }, data: { deletedAt: new Date() } }),
      this.prisma.pipeline.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
  }

  private async nextPosition(organizationId: string): Promise<number> {
    const last = await this.prisma.pipeline.findFirst({
      where: { organizationId, deletedAt: null },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    return (last?.position ?? -1) + 1;
  }

  private async requirePipeline(
    organizationId: string,
    id: string,
  ): Promise<PipelineRow & { stages: StageRow[] }> {
    const pipeline = await this.prisma.pipeline.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: INCLUDE_STAGES,
    });
    if (!pipeline) throw new NotFoundException('Pipeline not found');
    return pipeline;
  }
}

export function serializePipeline(pipeline: PipelineRow & { stages: StageRow[] }): PipelineDto {
  return {
    id: pipeline.id,
    organizationId: pipeline.organizationId,
    name: pipeline.name,
    isDefault: pipeline.isDefault,
    position: pipeline.position,
    stages: pipeline.stages.map(serializeStage),
    createdAt: pipeline.createdAt.toISOString(),
    updatedAt: pipeline.updatedAt.toISOString(),
  };
}
