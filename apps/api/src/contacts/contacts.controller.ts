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
  CreateContactInput,
  ListQueryInput,
  PERMISSIONS,
  UpdateContactInput,
  type Contact,
  type ContactListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ContactsService } from './contacts.service';

@Controller('contacts')
export class ContactsController {
  constructor(private readonly contacts: ContactsService) {}

  @Get()
  @RequirePermission(PERMISSIONS.CONTACT_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(ListQueryInput)) query: ListQueryInput,
  ): Promise<ContactListResponse> {
    return this.contacts.list(ctx.organization.id, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.CONTACT_READ)
  async get(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Contact> {
    return this.contacts.get(ctx.organization.id, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  async create(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(CreateContactInput)) body: CreateContactInput,
  ): Promise<Contact> {
    return this.contacts.create(ctx.organization.id, body, ctx.user.id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  async update(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateContactInput)) body: UpdateContactInput,
  ): Promise<Contact> {
    return this.contacts.update(ctx.organization.id, id, body, ctx.user.id);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.CONTACT_MANAGE)
  @HttpCode(204)
  async remove(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<void> {
    await this.contacts.remove(ctx.organization.id, id);
  }
}
