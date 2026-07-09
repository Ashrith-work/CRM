import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConvertLeadInput,
  ConvertLeadResponse,
  CreateLeadInput,
  CustomFieldValues,
  Lead as LeadDto,
  LeadStatus,
  ListQueryInput,
  Tag,
  UpdateLeadInput,
} from '@crm/types';
import { Prisma, type Lead as LeadRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { TagsService } from '../tags/tags.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { ContactsService } from '../contacts/contacts.service';
import { CompaniesService } from '../companies/companies.service';
import { IdentityService } from '../customers/identity.service';
import { CustomerPiiService } from '../customers/customer-pii.service';
import { cursorArgs, resolveOrderBy, toPage } from '../common/list.util';

const SORTABLE = ['firstName', 'lastName', 'status', 'createdAt', 'updatedAt'] as const;

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly tags: TagsService,
    private readonly customFields: CustomFieldsService,
    private readonly contacts: ContactsService,
    private readonly companies: CompaniesService,
    private readonly identity: IdentityService,
    private readonly pii: CustomerPiiService,
  ) {}

  async list(
    organizationId: string,
    query: ListQueryInput,
  ): Promise<{ data: LeadDto[]; nextCursor: string | null }> {
    const where: Prisma.LeadWhereInput = { organizationId, deletedAt: null };
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { firstName: { contains: query.search, mode: 'insensitive' } },
        { lastName: { contains: query.search, mode: 'insensitive' } },
        { email: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.tagId) {
      const ids = await this.tags.entityIdsForTag(organizationId, 'LEAD', query.tagId);
      where.id = { in: ids.length ? ids : ['__none__'] };
    }

    const rows = await this.prisma.lead.findMany({
      where,
      orderBy: resolveOrderBy(query.sort, query.order, SORTABLE),
      take: query.limit + 1,
      ...cursorArgs(query.cursor),
    });

    const page = toPage(rows, query.limit);
    const tagMap = await this.tags.tagsForEntities(organizationId, 'LEAD', page.data.map((l) => l.id));
    return {
      data: page.data.map((l) => serializeLead(l, tagMap.get(l.id) ?? [])),
      nextCursor: page.nextCursor,
    };
  }

  async get(organizationId: string, id: string): Promise<LeadDto> {
    const lead = await this.requireLead(organizationId, id);
    const tagMap = await this.tags.tagsForEntities(organizationId, 'LEAD', [id]);
    return serializeLead(lead, tagMap.get(id) ?? []);
  }

  async create(
    organizationId: string,
    input: CreateLeadInput,
    actorId: string,
    source = 'api',
  ): Promise<LeadDto> {
    if (input.status === 'CONVERTED') {
      throw new BadRequestException('Cannot create a lead as CONVERTED; use the convert endpoint');
    }
    const customFields = await this.customFields.validate(organizationId, 'LEAD', input.customFields);

    const lead = await this.prisma.lead.create({
      data: {
        organizationId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email || null,
        phone: input.phone,
        source: input.source,
        status: input.status ?? 'NEW',
        ownerId: input.ownerId ?? actorId,
        firstTouchTouchpointId: input.firstTouchTouchpointId ?? null,
        customFields: customFields as Prisma.InputJsonValue,
      },
    });

    if (input.tagIds?.length) {
      await this.tags.setEntityTags(organizationId, 'LEAD', lead.id, input.tagIds, actorId);
    }
    await this.activity.emit({
      organizationId,
      entityType: 'LEAD',
      entityId: lead.id,
      eventType: 'CREATED',
      actorId,
      source,
    });

    return this.get(organizationId, lead.id);
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateLeadInput,
    actorId: string,
    source = 'api',
  ): Promise<LeadDto> {
    const current = await this.requireLead(organizationId, id);
    if (input.status === 'CONVERTED' && current.status !== 'CONVERTED') {
      throw new BadRequestException('Set status to CONVERTED via the convert endpoint');
    }
    const customFields =
      input.customFields !== undefined
        ? await this.customFields.validate(organizationId, 'LEAD', input.customFields)
        : undefined;

    await this.prisma.lead.update({
      where: { id },
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email === undefined ? undefined : input.email || null,
        phone: input.phone,
        source: input.source,
        status: input.status,
        ownerId: input.ownerId,
        ...(customFields !== undefined ? { customFields: customFields as Prisma.InputJsonValue } : {}),
      },
    });

    if (input.tagIds) {
      await this.tags.setEntityTags(organizationId, 'LEAD', id, input.tagIds, actorId);
    }
    await this.activity.emit({
      organizationId,
      entityType: 'LEAD',
      entityId: id,
      eventType: 'UPDATED',
      actorId,
      source,
    });
    if (input.status && input.status !== current.status) {
      await this.emitStatusChange(organizationId, id, current.status, input.status, actorId, source);
    }

    return this.get(organizationId, id);
  }

  /** Dedicated status transition (mobile + web lead control). */
  async updateStatus(
    organizationId: string,
    id: string,
    status: LeadStatus,
    actorId: string,
    source = 'api',
  ): Promise<LeadDto> {
    const current = await this.requireLead(organizationId, id);
    if (status === 'CONVERTED') {
      throw new BadRequestException('Set status to CONVERTED via the convert endpoint');
    }
    if (current.status !== status) {
      await this.prisma.lead.update({ where: { id }, data: { status } });
      await this.emitStatusChange(organizationId, id, current.status, status, actorId, source);
    }
    return this.get(organizationId, id);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.requireLead(organizationId, id);
    await this.prisma.lead.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  /**
   * Convert a lead → contact (deduped by email) AND → commerce Customer
   * (find-or-create by email/phone via M1 identity resolution), optionally
   * creating/linking a company. Sets convertedCustomerId, re-attributes the
   * lead's first-touch touchpoint to the customer, and drops the lead onto the
   * customer 360 timeline. Blocks if already converted.
   */
  async convert(
    organizationId: string,
    id: string,
    input: ConvertLeadInput,
    actorId: string,
    source = 'api',
  ): Promise<ConvertLeadResponse> {
    const lead = await this.requireLead(organizationId, id);
    if (lead.status === 'CONVERTED' || lead.convertedContactId) {
      throw new ConflictException('Lead is already converted');
    }

    // Resolve the target company (outside the tx; validation/creation is idempotent enough).
    let companyId: string | null = null;
    let companyCreated = false;
    if (input.companyId) {
      const company = await this.prisma.company.findFirst({
        where: { id: input.companyId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!company) throw new BadRequestException('companyId does not reference a company in this org');
      companyId = company.id;
    } else if (input.companyName) {
      const created = await this.companies.create(
        organizationId,
        { name: input.companyName },
        actorId,
        source,
      );
      companyId = created.id;
      companyCreated = true;
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // Dedup contact by email (case-insensitive).
      let contact = lead.email
        ? await tx.contact.findFirst({
            where: {
              organizationId,
              deletedAt: null,
              email: { equals: lead.email, mode: 'insensitive' },
            },
          })
        : null;
      let contactCreated = false;

      if (!contact) {
        contact = await tx.contact.create({
          data: {
            organizationId,
            firstName: lead.firstName,
            lastName: lead.lastName,
            email: lead.email,
            phone: lead.phone,
            ownerId: lead.ownerId ?? actorId,
            companyId,
          },
        });
        contactCreated = true;
      } else if (companyId && !contact.companyId) {
        contact = await tx.contact.update({ where: { id: contact.id }, data: { companyId } });
      }

      await tx.lead.update({
        where: { id },
        data: { status: 'CONVERTED', convertedContactId: contact.id },
      });

      return { contactId: contact.id, contactCreated };
    });

    // Find-or-create the commerce Customer (deduped by email/phone via M1
    // identity resolution, which also re-attributes any Order/Cart/Event to the
    // survivor). Only when the lead carries an identifier — no anonymous rows.
    let customerId: string | null = null;
    let customerCreated = false;
    if (lead.email || lead.phone) {
      const before = await this.prisma.customer.findFirst({
        where: {
          organizationId,
          deletedAt: null,
          mergedIntoId: null,
          OR: [
            ...(this.pii.emailHashOf(lead.email) ? [{ emailHash: this.pii.emailHashOf(lead.email)! }] : []),
            ...(this.pii.phoneHashOf(lead.phone) ? [{ phoneHash: this.pii.phoneHashOf(lead.phone)! }] : []),
          ],
        },
        select: { id: true },
      });
      customerId = await this.identity.resolveCustomer(
        organizationId,
        { email: lead.email, phone: lead.phone, firstName: lead.firstName, lastName: lead.lastName },
        actorId,
      );
      customerCreated = !before;
      await this.prisma.lead.update({ where: { id }, data: { convertedCustomerId: customerId } });

      // Re-attribute the lead's first touch to the customer (first-touch credit).
      if (lead.firstTouchTouchpointId) {
        await this.prisma.touchpoint.updateMany({
          where: { id: lead.firstTouchTouchpointId, organizationId },
          data: { customerId },
        });
      }

      // Drop the lead onto the customer 360 timeline (idempotent on org+type+refId).
      const summary = `Converted from lead: ${[lead.firstName, lead.lastName].filter(Boolean).join(' ')}`;
      await this.prisma.interaction.upsert({
        where: { organizationId_type_refId: { organizationId, type: 'LEAD', refId: id } },
        update: { customerId, summary, occurredAt: new Date() },
        create: { organizationId, customerId, type: 'LEAD', refId: id, summary, occurredAt: new Date() },
      });
    }

    // Emit domain events after commit.
    if (result.contactCreated) {
      await this.activity.emit({
        organizationId,
        entityType: 'CONTACT',
        entityId: result.contactId,
        eventType: 'CREATED',
        actorId,
        metadata: { convertedFromLeadId: id },
        source,
      });
    }
    await this.activity.emit({
      organizationId,
      entityType: 'LEAD',
      entityId: id,
      eventType: 'CONVERTED',
      actorId,
      metadata: { contactId: result.contactId, contactCreated: result.contactCreated, companyId, companyCreated, customerId, customerCreated },
      source,
    });

    const customer = customerId
      ? this.identity.serialize(await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } }))
      : null;

    return {
      lead: await this.get(organizationId, id),
      contact: await this.contacts.get(organizationId, result.contactId),
      company: companyId ? await this.companies.get(organizationId, companyId) : null,
      contactCreated: result.contactCreated,
      customer,
      customerCreated,
    };
  }

  private async emitStatusChange(
    organizationId: string,
    id: string,
    from: LeadStatus,
    to: LeadStatus,
    actorId: string,
    source: string,
  ): Promise<void> {
    await this.activity.emit({
      organizationId,
      entityType: 'LEAD',
      entityId: id,
      eventType: 'STATUS_CHANGED',
      actorId,
      metadata: { from, to },
      source,
    });
  }

  private async requireLead(organizationId: string, id: string): Promise<LeadRow> {
    const lead = await this.prisma.lead.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!lead) throw new NotFoundException('Lead not found');
    return lead;
  }
}

export function serializeLead(lead: LeadRow, tags: Tag[]): LeadDto {
  return {
    id: lead.id,
    organizationId: lead.organizationId,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    source: lead.source,
    status: lead.status,
    ownerId: lead.ownerId,
    convertedContactId: lead.convertedContactId,
    convertedCustomerId: lead.convertedCustomerId,
    firstTouchTouchpointId: lead.firstTouchTouchpointId,
    customFields: (lead.customFields as CustomFieldValues) ?? {},
    tags,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}
