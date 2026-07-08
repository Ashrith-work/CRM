import { Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { PERMISSIONS, type Campaign, type CampaignListResponse, type EnrollmentListResponse, type RecoveryStats } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { Public } from '../auth/public.decorator';
import { canSeeUnmaskedPii } from '../common/pii.util';
import { CampaignService } from './campaign.service';
import { CampaignEngine } from './campaign-engine.service';
import { ResendWebhookService } from './resend-webhook.service';

@Controller('campaigns')
export class CampaignsController {
  constructor(
    private readonly campaigns: CampaignService,
    private readonly engine: CampaignEngine,
    private readonly webhooks: ResendWebhookService,
  ) {}

  @Get()
  @RequirePermission(PERMISSIONS.CAMPAIGN_READ)
  async list(@CurrentUser() ctx: UserContext): Promise<CampaignListResponse> {
    return { data: await this.campaigns.list(ctx.organization.id) };
  }

  /** The MVP recovery tile: recovery rate + recovered revenue on real orders. */
  @Get('recovery-stats')
  @RequirePermission(PERMISSIONS.CAMPAIGN_READ)
  async recoveryStats(@CurrentUser() ctx: UserContext): Promise<RecoveryStats> {
    return this.campaigns.recoveryStats(ctx.organization.id);
  }

  /** Public unsubscribe link (HMAC-signed) → Suppression(UNSUBSCRIBE). */
  @Get('unsubscribe')
  @Public()
  @Header('content-type', 'text/html')
  async unsubscribe(@Query('e') email: string, @Query('o') organizationId: string, @Query('sig') sig: string): Promise<string> {
    if (!email || !organizationId || !sig || !this.engine.verifyUnsubscribe(organizationId, email, sig)) {
      return page('This unsubscribe link is invalid or expired.');
    }
    await this.webhooks.suppress(organizationId, email, 'UNSUBSCRIBE');
    return page(`You've been unsubscribed. You will no longer receive marketing emails.`);
  }

  @Post('run')
  @RequirePermission(PERMISSIONS.CAMPAIGN_MANAGE)
  @HttpCode(200)
  async run(): Promise<{ enrolled: number; sent: number }> {
    const now = new Date();
    const enrolled = await this.engine.runEnrollmentSweep(now);
    const sent = await this.engine.runSendSweep(now);
    return { enrolled, sent };
  }

  @Get(':id/enrollments')
  @RequirePermission(PERMISSIONS.CAMPAIGN_READ)
  async enrollments(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Query('cursor') cursor: string | undefined,
    @Query('limit') limit: string | undefined,
  ): Promise<EnrollmentListResponse> {
    await this.campaigns.requireCampaign(ctx.organization.id, id);
    const take = Math.min(100, Math.max(1, Number(limit) || 50));
    return this.campaigns.enrollments(ctx.organization.id, id, cursor, take, canSeeUnmaskedPii(ctx.permissions));
  }
}

function page(message: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribe</title></head><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;text-align:center"><p>${message}</p></body></html>`;
}
