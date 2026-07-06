import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import {
  CreateNoteInput,
  FeedQueryInput,
  PERMISSIONS,
  type Note,
  type NoteListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { NotesService } from './notes.service';

@Controller('notes')
export class NotesController {
  constructor(private readonly notes: NotesService) {}

  /** GET /api/v1/notes?entityType=CONTACT&entityId=... — newest-first. */
  @Get()
  @RequirePermission(PERMISSIONS.NOTE_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(FeedQueryInput)) query: FeedQueryInput,
  ): Promise<NoteListResponse> {
    return this.notes.list(ctx.organization.id, query);
  }

  @Post()
  @RequirePermission(PERMISSIONS.NOTE_MANAGE)
  async create(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(CreateNoteInput)) body: CreateNoteInput,
  ): Promise<Note> {
    return this.notes.create(ctx.organization.id, body, ctx.user.id);
  }
}
