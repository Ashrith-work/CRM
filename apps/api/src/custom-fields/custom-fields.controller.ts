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
  CreateCustomFieldInput,
  EntityTypeSchema,
  PERMISSIONS,
  UpdateCustomFieldInput,
  type CustomFieldDefinition,
  type CustomFieldListResponse,
  type EntityType,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CustomFieldsService } from './custom-fields.service';

@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly customFields: CustomFieldsService) {}

  /** GET /api/v1/custom-fields?entityType=CONTACT (entityType optional). */
  @Get()
  @RequirePermission(PERMISSIONS.CUSTOM_FIELD_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query('entityType') entityType?: string,
  ): Promise<CustomFieldListResponse> {
    const parsed = entityType ? EntityTypeSchema.parse(entityType) : undefined;
    return { data: await this.customFields.list(ctx.organization.id, parsed as EntityType | undefined) };
  }

  @Post()
  @RequirePermission(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async create(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(CreateCustomFieldInput)) body: CreateCustomFieldInput,
  ): Promise<CustomFieldDefinition> {
    return this.customFields.create(ctx.organization.id, body);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  async update(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCustomFieldInput)) body: UpdateCustomFieldInput,
  ): Promise<CustomFieldDefinition> {
    return this.customFields.update(ctx.organization.id, id, body);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.CUSTOM_FIELD_MANAGE)
  @HttpCode(204)
  async remove(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<void> {
    await this.customFields.remove(ctx.organization.id, id);
  }
}
