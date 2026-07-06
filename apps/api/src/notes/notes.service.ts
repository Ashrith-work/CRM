import { Injectable } from '@nestjs/common';
import type { CreateNoteInput, FeedQueryInput, Note as NoteDto } from '@crm/types';
import type { Note as NoteRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { resolveActors } from '../common/actors.util';
import { assertEntityInOrg } from '../common/entity.util';
import { toPage } from '../common/list.util';
import type { Actor } from '@crm/types';

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  async create(
    organizationId: string,
    input: CreateNoteInput,
    authorId: string,
    source = 'api',
  ): Promise<NoteDto> {
    await assertEntityInOrg(this.prisma, organizationId, input.entityType, input.entityId);

    const note = await this.prisma.note.create({
      data: {
        organizationId,
        entityType: input.entityType,
        entityId: input.entityId,
        authorId,
        body: input.body,
      },
    });

    await this.activity.emit({
      organizationId,
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: 'NOTE_ADDED',
      actorId: authorId,
      metadata: { noteId: note.id },
      source,
    });

    const actors = await resolveActors(this.prisma, organizationId, [authorId]);
    return serializeNote(note, actors);
  }

  async list(
    organizationId: string,
    query: FeedQueryInput,
  ): Promise<{ data: NoteDto[]; nextCursor: string | null }> {
    const rows = await this.prisma.note.findMany({
      where: {
        organizationId,
        entityType: query.entityType,
        entityId: query.entityId,
        deletedAt: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const page = toPage(rows, query.limit);
    const actors = await resolveActors(this.prisma, organizationId, page.data.map((n) => n.authorId));
    return {
      data: page.data.map((n) => serializeNote(n, actors)),
      nextCursor: page.nextCursor,
    };
  }
}

export function serializeNote(note: NoteRow, actors: Map<string, Actor>): NoteDto {
  return {
    id: note.id,
    organizationId: note.organizationId,
    entityType: note.entityType,
    entityId: note.entityId,
    authorId: note.authorId,
    author: actors.get(note.authorId) ?? null,
    body: note.body,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}
