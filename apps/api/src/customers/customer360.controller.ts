import { Body, Controller, Get, NotFoundException, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  AddEscalationInput,
  CustomerListQueryInput,
  LookupQueryInput,
  PERMISSIONS,
  RecentOrdersQueryInput,
  SuggestQueryInput,
  TimelineQueryInput,
  type Customer360,
  type CustomerListResponse,
  type EscalationListResponse,
  type EscalationSummaryDto,
  type ExportAsyncResponse,
  type ExportStatusResponse,
  type LookupResponse,
  type PurchaseProfile,
  type RecentOrdersResponse,
  type SuggestResponse,
  type TimelineResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { canSeeUnmaskedPii } from '../common/pii.util';
import { Customer360Service } from './customer360.service';
import { ExperienceExportService } from './experience-export.service';
import { PurchaseAnalysisService } from './purchase-analysis.service';
import { EscalationService } from './escalation.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const SegmentExportInput = z.object({ customerIds: z.array(z.string().min(1)).min(1).max(5000) });

@Controller('customers')
export class Customer360Controller {
  constructor(
    private readonly customers: Customer360Service,
    private readonly exports: ExperienceExportService,
    private readonly purchase: PurchaseAnalysisService,
    private readonly escalations: EscalationService,
  ) {}

  // ----- Purchase Analysis: typeahead + lookup (STATIC routes, declared before
  // ':id' so they are matched first). --------------------------------------
  @Get('suggest')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async suggest(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(SuggestQueryInput)) query: SuggestQueryInput,
  ): Promise<SuggestResponse> {
    return { data: await this.purchase.suggest(ctx.organization.id, query.q, canSeeUnmaskedPii(ctx.permissions), query.limit) };
  }

  @Get('lookup')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async lookup(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(LookupQueryInput)) query: LookupQueryInput,
  ): Promise<LookupResponse> {
    return this.purchase.lookup(ctx.organization.id, query.q, canSeeUnmaskedPii(ctx.permissions));
  }

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

  // ----- Purchase Analysis: profile (last + 2nd-last) + escalations --------
  @Get(':id/purchase-profile')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async purchaseProfile(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<PurchaseProfile> {
    return this.purchase.profile(ctx.organization.id, id, canSeeUnmaskedPii(ctx.permissions), ctx.user.id);
  }

  @Get(':id/escalations')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async listEscalations(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<EscalationListResponse> {
    return { data: await this.escalations.list(ctx.organization.id, id) };
  }

  @Post(':id/escalations')
  @RequirePermission(PERMISSIONS.COMMERCE_READ)
  async addEscalation(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddEscalationInput)) body: AddEscalationInput,
  ): Promise<EscalationSummaryDto> {
    return this.escalations.add(ctx.organization.id, id, body, ctx.user.id);
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
