import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateTagInput,
  EntityType,
  Tag as TagDto,
  TagAssignmentInput,
  UpdateTagInput,
} from '@crm/types';
import { Prisma, type Tag as TagRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';

@Injectable()
export class TagsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async list(organizationId: string): Promise<TagDto[]> {
    const tags = await this.prisma.tag.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: { name: 'asc' },
    });
    return tags.map(serializeTag);
  }

  async create(organizationId: string, input: CreateTagInput): Promise<TagDto> {
    try {
      const tag = await this.prisma.tag.create({
        data: { organizationId, name: input.name, color: input.color },
      });
      return serializeTag(tag);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A tag named "${input.name}" already exists`);
      }
      throw err;
    }
  }

  async update(organizationId: string, id: string, input: UpdateTagInput): Promise<TagDto> {
    await this.requireTag(organizationId, id);
    try {
      const tag = await this.prisma.tag.update({
        where: { id },
        data: { name: input.name, color: input.color },
      });
      return serializeTag(tag);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(`A tag named "${input.name}" already exists`);
      }
      throw err;
    }
  }

  /** Soft-delete the tag and remove all its assignments. */
  async remove(organizationId: string, id: string): Promise<void> {
    await this.requireTag(organizationId, id);
    await this.prisma.$transaction([
      this.prisma.taggable.deleteMany({ where: { organizationId, tagId: id } }),
      this.prisma.tag.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
  }

  async assign(organizationId: string, input: TagAssignmentInput, actorId: string): Promise<void> {
    await this.requireTag(organizationId, input.tagId);
    const created = await this.prisma.taggable.upsert({
      where: {
        tagId_entityType_entityId: {
          tagId: input.tagId,
          entityType: input.entityType,
          entityId: input.entityId,
        },
      },
      update: {},
      create: {
        organizationId,
        tagId: input.tagId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
    // Only emit when the assignment is new (upsert returns the existing row otherwise
    // we can't tell — so guard by checking createdAt proximity is brittle; instead
    // emit on every explicit assign call, which is user-initiated).
    void created;
    await this.activity.emit({
      organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: 'TAG_ADDED',
      actorId,
      metadata: { tagId: input.tagId },
    });
  }

  async unassign(organizationId: string, input: TagAssignmentInput): Promise<void> {
    await this.prisma.taggable.deleteMany({
      where: {
        organizationId,
        tagId: input.tagId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });
  }

  /**
   * Replace an entity's tag set with exactly `tagIds`. Emits TAG_ADDED for
   * newly added tags. Used by contact/company/lead create + update.
   */
  async setEntityTags(
    organizationId: string,
    entityType: EntityType,
    entityId: string,
    tagIds: string[],
    actorId: string,
  ): Promise<void> {
    const valid = await this.prisma.tag.findMany({
      where: { organizationId, deletedAt: null, id: { in: tagIds } },
      select: { id: true },
    });
    const validIds = new Set(valid.map((t) => t.id));

    const current = await this.prisma.taggable.findMany({
      where: { organizationId, entityType, entityId },
      select: { tagId: true },
    });
    const currentIds = new Set(current.map((t) => t.tagId));

    const toAdd = [...validIds].filter((id) => !currentIds.has(id));
    const toRemove = [...currentIds].filter((id) => !validIds.has(id));

    if (toRemove.length > 0) {
      await this.prisma.taggable.deleteMany({
        where: { organizationId, entityType, entityId, tagId: { in: toRemove } },
      });
    }
    if (toAdd.length > 0) {
      await this.prisma.taggable.createMany({
        data: toAdd.map((tagId) => ({ organizationId, tagId, entityType, entityId })),
        skipDuplicates: true,
      });
      for (const tagId of toAdd) {
        await this.activity.emit({
          organizationId,
          entityType,
          entityId,
          eventType: 'TAG_ADDED',
          actorId,
          metadata: { tagId },
        });
      }
    }
  }

  /** Tags grouped by entityId for a page of entities (single query). */
  async tagsForEntities(
    organizationId: string,
    entityType: EntityType,
    entityIds: string[],
  ): Promise<Map<string, TagDto[]>> {
    const result = new Map<string, TagDto[]>();
    if (entityIds.length === 0) return result;

    const rows = await this.prisma.taggable.findMany({
      where: { organizationId, entityType, entityId: { in: entityIds }, tag: { deletedAt: null } },
      include: { tag: true },
    });
    for (const row of rows) {
      const list = result.get(row.entityId) ?? [];
      list.push(serializeTag(row.tag));
      result.set(row.entityId, list);
    }
    return result;
  }

  /** Entity ids carrying a given tag — used to filter a list by tag. */
  async entityIdsForTag(
    organizationId: string,
    entityType: EntityType,
    tagId: string,
  ): Promise<string[]> {
    const rows = await this.prisma.taggable.findMany({
      where: { organizationId, entityType, tagId },
      select: { entityId: true },
    });
    return rows.map((r) => r.entityId);
  }

  private async requireTag(organizationId: string, id: string): Promise<void> {
    const tag = await this.prisma.tag.findFirst({ where: { id, organizationId, deletedAt: null } });
    if (!tag) throw new NotFoundException('Tag not found');
  }
}

export function serializeTag(tag: TagRow): TagDto {
  return {
    id: tag.id,
    organizationId: tag.organizationId,
    name: tag.name,
    color: tag.color,
    createdAt: tag.createdAt.toISOString(),
    updatedAt: tag.updatedAt.toISOString(),
  };
}
