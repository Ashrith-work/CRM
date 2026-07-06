import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  Contact as ContactDto,
  CreateContactInput,
  CustomFieldValues,
  ListQueryInput,
  Tag,
  UpdateContactInput,
} from '@crm/types';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { TagsService } from '../tags/tags.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { cursorArgs, resolveOrderBy, toPage } from '../common/list.util';

const SORTABLE = ['firstName', 'lastName', 'createdAt', 'updatedAt'] as const;

/** Contact row with the slim company relation we embed in responses. */
type ContactWithCompany = Prisma.ContactGetPayload<{
  include: { company: { select: { id: true; name: true } } };
}>;

const INCLUDE_COMPANY = { company: { select: { id: true, name: true } } } as const;

@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly tags: TagsService,
    private readonly customFields: CustomFieldsService,
  ) {}

  async list(
    organizationId: string,
    query: ListQueryInput,
  ): Promise<{ data: ContactDto[]; nextCursor: string | null }> {
    const where: Prisma.ContactWhereInput = { organizationId, deletedAt: null };
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.companyId) where.companyId = query.companyId;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.tagId) {
      const ids = await this.tags.entityIdsForTag(organizationId, 'CONTACT', query.tagId);
      where.id = { in: ids.length ? ids : ['__none__'] };
    }

    const rows = await this.prisma.contact.findMany({
      where,
      include: INCLUDE_COMPANY,
      orderBy: resolveOrderBy(query.sort, query.order, SORTABLE),
      take: query.limit + 1,
      ...cursorArgs(query.cursor),
    });

    const page = toPage(rows, query.limit);
    const tagMap = await this.tags.tagsForEntities(organizationId, 'CONTACT', page.data.map((c) => c.id));
    return {
      data: page.data.map((c) => serializeContact(c, tagMap.get(c.id) ?? [])),
      nextCursor: page.nextCursor,
    };
  }

  async get(organizationId: string, id: string): Promise<ContactDto> {
    const contact = await this.prisma.contact.findFirst({
      where: { id, organizationId, deletedAt: null },
      include: INCLUDE_COMPANY,
    });
    if (!contact) throw new NotFoundException('Contact not found');
    const tagMap = await this.tags.tagsForEntities(organizationId, 'CONTACT', [id]);
    return serializeContact(contact, tagMap.get(id) ?? []);
  }

  async create(
    organizationId: string,
    input: CreateContactInput,
    actorId: string,
    source = 'api',
  ): Promise<ContactDto> {
    const customFields = await this.customFields.validate(organizationId, 'CONTACT', input.customFields);
    const companyId = await this.resolveCompanyId(organizationId, input.companyId ?? null);

    const contact = await this.prisma.contact.create({
      data: {
        organizationId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email || null,
        phone: input.phone,
        jobTitle: input.jobTitle,
        companyId,
        ownerId: input.ownerId ?? actorId,
        customFields: customFields as Prisma.InputJsonValue,
      },
    });

    if (input.tagIds?.length) {
      await this.tags.setEntityTags(organizationId, 'CONTACT', contact.id, input.tagIds, actorId);
    }
    await this.activity.emit({
      organizationId,
      entityType: 'CONTACT',
      entityId: contact.id,
      eventType: 'CREATED',
      actorId,
      source,
    });

    return this.get(organizationId, contact.id);
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateContactInput,
    actorId: string,
    source = 'api',
  ): Promise<ContactDto> {
    await this.get(organizationId, id); // existence + org scope
    const customFields =
      input.customFields !== undefined
        ? await this.customFields.validate(organizationId, 'CONTACT', input.customFields)
        : undefined;
    const companyId =
      input.companyId !== undefined
        ? await this.resolveCompanyId(organizationId, input.companyId)
        : undefined;

    await this.prisma.contact.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email === undefined ? undefined : input.email || null,
        phone: input.phone,
        jobTitle: input.jobTitle,
        ...(companyId !== undefined ? { companyId } : {}),
        ownerId: input.ownerId,
        ...(customFields !== undefined ? { customFields: customFields as Prisma.InputJsonValue } : {}),
      },
    });

    if (input.tagIds) {
      await this.tags.setEntityTags(organizationId, 'CONTACT', id, input.tagIds, actorId);
    }
    await this.activity.emit({
      organizationId,
      entityType: 'CONTACT',
      entityId: id,
      eventType: 'UPDATED',
      actorId,
      source,
    });

    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.get(organizationId, id);
    await this.prisma.contact.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /** Validate an incoming companyId belongs to the org (or clear it). */
  private async resolveCompanyId(
    organizationId: string,
    companyId: string | null,
  ): Promise<string | null> {
    if (!companyId) return null;
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw new BadRequestException('companyId does not reference a company in this org');
    return company.id;
  }
}

export function serializeContact(contact: ContactWithCompany, tags: Tag[]): ContactDto {
  return {
    id: contact.id,
    organizationId: contact.organizationId,
    firstName: contact.firstName,
    lastName: contact.lastName,
    email: contact.email,
    phone: contact.phone,
    jobTitle: contact.jobTitle,
    companyId: contact.companyId,
    company: contact.company ? { id: contact.company.id, name: contact.company.name } : null,
    ownerId: contact.ownerId,
    customFields: (contact.customFields as CustomFieldValues) ?? {},
    tags,
    createdAt: contact.createdAt.toISOString(),
    updatedAt: contact.updatedAt.toISOString(),
  };
}
