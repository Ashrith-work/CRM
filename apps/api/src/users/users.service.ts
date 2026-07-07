import { Injectable } from '@nestjs/common';
import type { OrgUser } from '@crm/types';
import { PrismaService } from '../prisma/prisma.service';
import { safeTimeZone } from '../common/timezone.util';

/**
 * Org user directory — powers the assignee picker on both clients — plus the
 * per-user timezone that reminders and agenda buckets resolve against.
 */
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string): Promise<OrgUser[]> {
    const users = await this.prisma.user.findMany({
      where: { organizationId },
      select: { id: true, email: true, firstName: true, lastName: true, timezone: true },
      orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
    });
    return users.map((u) => ({ ...u, timezone: safeTimeZone(u.timezone) }));
  }

  /** Returns the user's stored timezone (falling back to UTC if unset/invalid). */
  async timezoneFor(organizationId: string, userId: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, organizationId },
      select: { timezone: true },
    });
    return safeTimeZone(user?.timezone);
  }

  async setTimezone(userId: string, timezone: string): Promise<string> {
    const tz = safeTimeZone(timezone);
    await this.prisma.user.update({ where: { id: userId }, data: { timezone: tz } });
    return tz;
  }
}
