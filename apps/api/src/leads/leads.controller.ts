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
  ConvertLeadInput,
  CreateLeadInput,
  ListQueryInput,
  PERMISSIONS,
  UpdateLeadInput,
  UpdateLeadStatusInput,
  type ConvertLeadResponse,
  type Lead,
  type LeadListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { LeadsService } from './leads.service';

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.LEAD_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(ListQueryInput)) query: ListQueryInput,
  ): Promise<LeadListResponse> {
    return this.leads.list(ctx.organization.id, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.LEAD_READ)
  async get(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Lead> {
    return this.leads.get(ctx.organization.id, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.LEAD_MANAGE)
  async create(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(CreateLeadInput)) body: CreateLeadInput,
  ): Promise<Lead> {
    return this.leads.create(ctx.organization.id, body, ctx.user.id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.LEAD_MANAGE)
  async update(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateLeadInput)) body: UpdateLeadInput,
  ): Promise<Lead> {
    return this.leads.update(ctx.organization.id, id, body, ctx.user.id);
  }

  /** Dedicated status transition. */
  @Patch(':id/status')
  @RequirePermission(PERMISSIONS.LEAD_MANAGE)
  async updateStatus(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateLeadStatusInput)) body: UpdateLeadStatusInput,
  ): Promise<Lead> {
    return this.leads.updateStatus(ctx.organization.id, id, body.status, ctx.user.id);
  }

  /** Convert lead → contact (dedup by email), optionally create/link company. */
  @Post(':id/convert')
  @RequirePermission(PERMISSIONS.LEAD_MANAGE, PERMISSIONS.CONTACT_MANAGE)
  async convert(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ConvertLeadInput)) body: ConvertLeadInput,
  ): Promise<ConvertLeadResponse> {
    return this.leads.convert(ctx.organization.id, id, body, ctx.user.id);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.LEAD_MANAGE)
  @HttpCode(204)
  async remove(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<void> {
    await this.leads.remove(ctx.organization.id, id);
  }
}
