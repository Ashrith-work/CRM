import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  CustomerListQueryInput,
  PERMISSIONS,
  RecentOrdersQueryInput,
  TimelineQueryInput,
  type Customer360,
  type CustomerListResponse,
  type ExportAsyncResponse,
  type ExportStatusResponse,
  type RecentOrdersResponse,
  type TimelineResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { canSeeUnmaskedPii } from '../common/pii.util';
import { Customer360Service } from './customer360.service';
import { ExperienceExportService } from './experience-export.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SegmentExportInput = z.object({ customerIds: z.array(z.string().min(1)).min(1).max(5000) });

@Controller('customers')
export class Customer360Controller {
  constructor(
    private readonly customers: Customer360Service,
    private readonly exports: ExperienceExportService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(CustomerListQueryInput)) query: CustomerListQueryInput,
  ): Promise<CustomerListResponse> {
    return this.customers.list(ctx.organization.id, query, canSeeUnmaskedPii(ctx.permissions));
  }

  // ----- async export status/download (declared before ':id' routes) ------
  @Get('exports/:jobId/status')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async exportStatus(@Param('jobId') jobId: string): Promise<ExportStatusResponse> {
    return this.exports.status(jobId);
  }

  @Get('exports/:jobId/download')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async exportDownload(@Param('jobId') jobId: string, @Res() res: Response): Promise<void> {
    const file = await this.exports.download(jobId);
    if (!file) throw new NotFoundException('Export not ready');
    stream(res, file.buffer, file.filename);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async get(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Customer360> {
    return this.customers.get360(ctx.organization.id, id, canSeeUnmaskedPii(ctx.permissions), ctx.user.id);
  }

  @Get(':id/timeline')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async timeline(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(TimelineQueryInput)) query: TimelineQueryInput,
  ): Promise<TimelineResponse> {
    return this.customers.timeline(ctx.organization.id, id, query);
  }

  @Get(':id/orders')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async orders(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Query(new ZodValidationPipe(RecentOrdersQueryInput)) query: RecentOrdersQueryInput,
  ): Promise<RecentOrdersResponse> {
    return { data: await this.customers.recentOrders(ctx.organization.id, id, query) };
  }

  /** Sync single-customer export — streams the .xlsx (masked unless pii:read). */
  @Get(':id/export')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async export(@CurrentUser() ctx: UserContext, @Param('id') id: string, @Res() res: Response): Promise<void> {
    const { buffer, filename } = await this.exports.exportCustomer(ctx.organization.id, id, ctx.user.id, canSeeUnmaskedPii(ctx.permissions));
    stream(res, buffer, filename);
  }

  /** Async single-customer export (for very large history). */
  @Post(':id/export/async')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async exportAsync(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<ExportAsyncResponse> {
    const jobId = await this.exports.enqueueExport(ctx.organization.id, ctx.user.id, [id], canSeeUnmaskedPii(ctx.permissions));
    return { jobId };
  }

  /** Admin batch: export a whole segment's experience into one workbook. */
  @Post('export/segment')
  @RequirePermission(PERMISSIONS.COMMERCE_MANAGE)
  async exportSegment(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(SegmentExportInput)) body: z.infer<typeof SegmentExportInput>,
  ): Promise<ExportAsyncResponse> {
    const jobId = await this.exports.enqueueExport(ctx.organization.id, ctx.user.id, body.customerIds, canSeeUnmaskedPii(ctx.permissions));
    return { jobId };
  }
}

function stream(res: Response, buffer: Buffer, filename: string): void {
  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(buffer);
}
