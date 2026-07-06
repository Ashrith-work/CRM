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
  CreateCompanyInput,
  ListQueryInput,
  PERMISSIONS,
  UpdateCompanyInput,
  type Company,
  type CompanyListResponse,
} from '@crm/types';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserContext } from '../auth/auth.types';
import { RequirePermission } from '../rbac/require-permission.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { CompaniesService } from './companies.service';

@Controller('companies')
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @RequirePermission(PERMISSIONS.COMPANY_READ)
  async list(
    @CurrentUser() ctx: UserContext,
    @Query(new ZodValidationPipe(ListQueryInput)) query: ListQueryInput,
  ): Promise<CompanyListResponse> {
    return this.companies.list(ctx.organization.id, query);
  }

  @Get(':id')
  @RequirePermission(PERMISSIONS.COMPANY_READ)
  async get(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<Company> {
    return this.companies.get(ctx.organization.id, id);
  }

  @Post()
  @RequirePermission(PERMISSIONS.COMPANY_MANAGE)
  async create(
    @CurrentUser() ctx: UserContext,
    @Body(new ZodValidationPipe(CreateCompanyInput)) body: CreateCompanyInput,
  ): Promise<Company> {
    return this.companies.create(ctx.organization.id, body, ctx.user.id);
  }

  @Patch(':id')
  @RequirePermission(PERMISSIONS.COMPANY_MANAGE)
  async update(
    @CurrentUser() ctx: UserContext,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateCompanyInput)) body: UpdateCompanyInput,
  ): Promise<Company> {
    return this.companies.update(ctx.organization.id, id, body, ctx.user.id);
  }

  @Delete(':id')
  @RequirePermission(PERMISSIONS.COMPANY_MANAGE)
  @HttpCode(204)
  async remove(@CurrentUser() ctx: UserContext, @Param('id') id: string): Promise<void> {
    await this.companies.remove(ctx.organization.id, id);
  }
}
