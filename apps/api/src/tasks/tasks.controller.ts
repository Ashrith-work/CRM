import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AgendaQueryInput,
  CompleteTaskInput,
  CreateTaskInput,
  PERMISSIONS,
  ReassignTaskInput,
  RescheduleTaskInput,
  SnoozeTaskInput,
  TaskListQueryInput,
  UpdateTaskInput,
  type AgendaResponse,
  type Task,
  type TaskListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  @RequirePermission(PERMISSIONS.TASK_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(TaskListQueryInput)) query: TaskListQueryInput,
  ): Promise<TaskListResponse> {
    return this.tasks.list(ctx.organization.id, ctx.user.id, query);
  }

  // Declared before ':id' so "/tasks/agenda" is not captured as an id.
  @Get('agenda')
  @RequirePermission(PERMISSIONS.TASK_READ)
  async agenda(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(AgendaQueryInput)) query: AgendaQueryInput,
  ): Promise<AgendaResponse> {
    return this.tasks.agenda(ctx.organization.id, ctx.user.id, query.assigneeId, query.type);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.TASK_READ)
  async get(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Task> {
    return this.tasks.get(ctx.organization.id, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.TASK_MANAGE)
  async create(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(CreateTaskInput)) body: CreateTaskInput,
  ): Promise<Task> {
    return this.tasks.create(ctx.organization.id, body, ctx.user.id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.TASK_MANAGE)
  async update(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateTaskInput)) body: UpdateTaskInput,
  ): Promise<Task> {
    return this.tasks.update(ctx.organization.id, id, body, ctx.user.id);
  }

  @Post(':id/complete')
  @RequirePermission(PERMISSIONS.TASK_MANAGE)
  async complete(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(CompleteTaskInput)) body: CompleteTaskInput,
  ): Promise<Task> {
    return this.tasks.complete(ctx.organization.id, id, body, ctx.user.id);
  }

  @Post(':id/cancel')
  @RequirePermission(PERMISSIONS.TASK_MANAGE)
  async cancel(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Task> {
    return this.tasks.cancel(ctx.organization.id, id, ctx.user.id);
  }

  @Post(':id/reschedule')
  @RequirePermission(PERMISSIONS.TASK_MANAGE)
  async reschedule(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(RescheduleTaskInput)) body: RescheduleTaskInput,
  ): Promise<Task> {
    return this.tasks.reschedule(ctx.organization.id, id, body, ctx.user.id);
  }

  @Post(':id/snooze')
  @RequirePermission(PERMISSIONS.TASK_MANAGE)
  async snooze(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(SnoozeTaskInput)) body: SnoozeTaskInput,
  ): Promise<Task> {
    return this.tasks.snooze(ctx.organization.id, id, body, ctx.user.id);
  }

  @Post(':id/reassign')
  @RequirePermission(PERMISSIONS.TASK_MANAGE)
  async reassign(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ReassignTaskInput)) body: ReassignTaskInput,
  ): Promise<Task> {
    return this.tasks.reassign(ctx.organization.id, id, body, ctx.user.id);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.TASK_MANAGE)
  @HttpCode(204)
  async remove(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<void> {
    await this.tasks.remove(ctx.organization.id, id);
  }
}
