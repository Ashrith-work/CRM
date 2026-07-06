import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateCustomFieldInput,
  CustomFieldDefinition as CustomFieldDto,
  CustomFieldValues,
  EntityType,
  UpdateCustomFieldInput,
} from '@crm/types';
import { Prisma, type CustomFieldDefinition as CustomFieldRow } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CustomFieldsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(organizationId: string, entityType?: EntityType): Promise<CustomFieldDto[]> {
    const defs = await this.prisma.customFieldDefinition.findMany({
      where: { organizationId, deletedAt: null, ...(entityType ? { entityType } : {}) },
      orderBy: [{ entityType: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
    });
    return defs.map(serializeCustomField);
  }

  async create(organizationId: string, input: CreateCustomFieldInput): Promise<CustomFieldDto> {
    try {
      const def = await this.prisma.customFieldDefinition.create({
        data: {
          organizationId,
          entityType: input.entityType,
          key: input.key,
          label: input.label,
          fieldType: input.fieldType,
          options: input.fieldType === 'SELECT' ? (input.options ?? []) : Prisma.JsonNull,
          required: input.required ?? false,
          order: input.order ?? 0,
        },
      });
      return serializeCustomField(def);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          `A ${input.entityType} custom field with key "${input.key}" already exists`,
        );
      }
      throw err;
    }
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateCustomFieldInput,
  ): Promise<CustomFieldDto> {
    const existing = await this.requireDef(organizationId, id);
    // SELECT fields must keep a non-empty option list.
    const nextOptions = input.options ?? (existing.options as string[] | null);
    if (existing.fieldType === 'SELECT' && (!nextOptions || nextOptions.length === 0)) {
      throw new BadRequestException('SELECT fields require a non-empty options array');
    }
    const def = await this.prisma.customFieldDefinition.update({
      where: { id },
      data: {
        label: input.label,
        required: input.required,
        order: input.order,
        ...(input.options !== undefined ? { options: input.options } : {}),
      },
    });
    return serializeCustomField(def);
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.requireDef(organizationId, id);
    await this.prisma.customFieldDefinition.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /**
   * Validate + coerce a custom-field value bag against the definitions for an
   * entity type. Throws BadRequestException (no partial write) on any mismatch:
   * unknown key, missing required field, or wrong type. Returns the normalized
   * values to persist.
   */
  async validate(
    organizationId: string,
    entityType: EntityType,
    values: CustomFieldValues | undefined,
  ): Promise<CustomFieldValues> {
    const defs = await this.prisma.customFieldDefinition.findMany({
      where: { organizationId, entityType, deletedAt: null },
    });
    return validateCustomFieldValues(defs, values);
  }

  private async requireDef(organizationId: string, id: string): Promise<CustomFieldRow> {
    const def = await this.prisma.customFieldDefinition.findFirst({
      where: { id, organizationId, deletedAt: null },
    });
    if (!def) throw new NotFoundException('Custom field not found');
    return def;
  }
}

/**
 * Pure validation used by the service and directly by unit tests. Enforces:
 * unknown keys rejected, required present, and per-type coercion.
 */
export function validateCustomFieldValues(
  defs: Array<Pick<CustomFieldRow, 'key' | 'label' | 'fieldType' | 'options' | 'required'>>,
  values: CustomFieldValues | undefined,
): CustomFieldValues {
  const input = values ?? {};
  const defByKey = new Map(defs.map((d) => [d.key, d]));
  const errors: string[] = [];
  const out: CustomFieldValues = {};

  for (const key of Object.keys(input)) {
    if (!defByKey.has(key)) errors.push(`Unknown custom field: ${key}`);
  }

  for (const def of defs) {
    const has = Object.prototype.hasOwnProperty.call(input, def.key);
    const raw = has ? input[def.key] : undefined;
    const empty = raw === undefined || raw === null || raw === '';
    if (empty) {
      if (def.required) errors.push(`${def.label} is required`);
      continue;
    }
    try {
      out[def.key] = coerceValue(def, raw);
    } catch (err) {
      errors.push(`${def.label}: ${(err as Error).message}`);
    }
  }

  if (errors.length > 0) {
    throw new BadRequestException({ statusCode: 400, error: 'Bad Request', message: errors });
  }
  return out;
}

function coerceValue(
  def: Pick<CustomFieldRow, 'fieldType' | 'options'>,
  raw: unknown,
): unknown {
  switch (def.fieldType) {
    case 'TEXT':
      if (typeof raw !== 'string') throw new Error('must be text');
      return raw;
    case 'NUMBER': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
      if (!Number.isFinite(n)) throw new Error('must be a number');
      return n;
    }
    case 'BOOLEAN':
      if (typeof raw === 'boolean') return raw;
      if (raw === 'true') return true;
      if (raw === 'false') return false;
      throw new Error('must be a boolean');
    case 'DATE': {
      if (typeof raw !== 'string' && !(raw instanceof Date)) throw new Error('must be a date');
      const t = new Date(raw as string | Date).getTime();
      if (Number.isNaN(t)) throw new Error('must be a valid date');
      return new Date(t).toISOString();
    }
    case 'SELECT': {
      const options = (def.options as string[] | null) ?? [];
      if (typeof raw !== 'string' || !options.includes(raw)) {
        throw new Error(`must be one of: ${options.join(', ')}`);
      }
      return raw;
    }
    default:
      throw new Error('unknown field type');
  }
}

export function serializeCustomField(def: CustomFieldRow): CustomFieldDto {
  return {
    id: def.id,
    organizationId: def.organizationId,
    entityType: def.entityType,
    key: def.key,
    label: def.label,
    fieldType: def.fieldType,
    options: (def.options as string[] | null) ?? null,
    required: def.required,
    order: def.order,
    createdAt: def.createdAt.toISOString(),
    updatedAt: def.updatedAt.toISOString(),
  };
}
