import { Injectable, NotFoundException } from '@nestjs/common';
import type {
  Address,
  Company as CompanyDto,
  CreateCompanyInput,
  CustomFieldValues,
  ListQueryInput,
  Tag,
  UpdateCompanyInput,
} from '@crm/types';
import { Prisma, type Company as CompanyRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityService } from '../activity/activity.service';
import { TagsService } from '../tags/tags.service';
import { CustomFieldsService } from '../custom-fields/custom-fields.service';
import { cursorArgs, resolveOrderBy, toPage } from '../common/list.util';

const SORTABLE = ['name', 'createdAt', 'updatedAt'] as const;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly tags: TagsService,
    private readonly customFields: CustomFieldsService,
  ) {}

  async list(
    organizationId: string,
    query: ListQueryInput,
  ): Promise<{ data: CompanyDto[]; nextCursor: string | null }> {
    const where: Prisma.CompanyWhereInput = { organizationId, deletedAt: null };
    if (query.ownerId) where.ownerId = query.ownerId;
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { domain: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.tagId) {
      const ids = await this.tags.entityIdsForTag(organizationId, 'COMPANY', query.tagId);
      where.id = { in: ids.length ? ids : ['__none__'] };
    }

    const rows = await this.prisma.company.findMany({
      where,
      orderBy: resolveOrderBy(query.sort, query.order, SORTABLE),
      take: query.limit + 1,
      ...cursorArgs(query.cursor),
    });

    const page = toPage(rows, query.limit);
    const tagMap = await this.tags.tagsForEntities(organizationId, 'COMPANY', page.data.map((c) => c.id));
    return {
      data: page.data.map((c) => serializeCompany(c, tagMap.get(c.id) ?? [])),
      nextCursor: page.nextCursor,
    };
  }

  async get(organizationId: string, id: string): Promise<CompanyDto> {
    const company = await this.requireCompany(organizationId, id);
    const tagMap = await this.tags.tagsForEntities(organizationId, 'COMPANY', [id]);
    return serializeCompany(company, tagMap.get(id) ?? []);
  }

  async create(
    organizationId: string,
    input: CreateCompanyInput,
    actorId: string,
    source = 'api',
  ): Promise<CompanyDto> {
    const customFields = await this.customFields.validate(organizationId, 'COMPANY', input.customFields);

    const company = await this.prisma.company.create({
      data: {
        organizationId,
        name: input.name,
        domain: input.domain,
        industry: input.industry,
        size: input.size,
        website: input.website,
        phone: input.phone,
        ownerId: input.ownerId ?? actorId,
        customFields: customFields as Prisma.InputJsonValue,
        ...(input.address ? { addressJson: input.address as Prisma.InputJsonValue } : {}),
      },
    });

    if (input.tagIds?.length) {
      await this.tags.setEntityTags(organizationId, 'COMPANY', company.id, input.tagIds, actorId);
    }
    await this.activity.emit({
      organizationId,
      entityType: 'COMPANY',
      entityId: company.id,
      eventType: 'CREATED',
      actorId,
      source,
    });

    return this.get(organizationId, company.id);
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateCompanyInput,
    actorId: string,
    source = 'api',
  ): Promise<CompanyDto> {
    await this.requireCompany(organizationId, id);
    const customFields =
      input.customFields !== undefined
        ? await this.customFields.validate(organizationId, 'COMPANY', input.customFields)
        : undefined;

    await this.prisma.company.update({
      where: { id },
      data: {
        name: input.name,
        domain: input.domain,
        industry: input.industry,
        size: input.size,
        website: input.website,
        phone: input.phone,
        ownerId: input.ownerId,
        ...(customFields !== undefined ? { customFields: customFields as Prisma.InputJsonValue } : {}),
        ...(input.address !== undefined ? { addressJson: (input.address ?? Prisma.JsonNull) as Prisma.InputJsonValue } : {}),
      },
    });

    if (input.tagIds) {
      await this.tags.setEntityTags(organizationId, 'COMPANY', id, input.tagIds, actorId);
    }
    await this.activity.emit({
      organizationId,
      entityType: 'COMPANY',
      entityId: id,
      eventType: 'UPDATED',
      actorId,
      source,
    });

    return this.get(organizationId, id);
  }

  /** Soft-delete; detach contacts (never cascade-delete them). */
  async remove(organizationId: string, id: string): Promise<void> {
    await this.requireCompany(organizationId, id);
    await this.prisma.$transaction([
      this.prisma.contact.updateMany({
        where: { organizationId, companyId: id },
        data: { companyId: null },
      }),
      this.prisma.company.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
  }

  private async requireCompany(organizationId: string, id: string): Promise<CompanyRow> {
    const company = await this.prisma.company.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!company) throw new NotFoundException('Company not found');
    return company;
  }
}

export function serializeCompany(company: CompanyRow, tags: Tag[]): CompanyDto {
  return {
    id: company.id,
    organizationId: company.organizationId,
    name: company.name,
    domain: company.domain,
    industry: company.industry,
    size: company.size,
    website: company.website,
    phone: company.phone,
    address: (company.addressJson as Address | null) ?? null,
    ownerId: company.ownerId,
    customFields: (company.customFields as CustomFieldValues) ?? {},
    tags,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}
