import { Controller, Get } from '@nestjs/common';
import { PERMISSIONS } from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Read recent audit logs for the caller's organization. Requires audit:read,
 * which members do NOT have — so this route returns 403 for members and 200 for
 * owners/admins, demonstrating RBAC over HTTP. Always org-scoped.
 */
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission(PERMISSIONS.AUDIT_READ)
  async list(@CurrentUser() ctx: UserContext) {
    const logs = await this.prisma.auditLog.findMany({
      where: { organizationId: ctx.organization.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return { data: logs };
  }
}
