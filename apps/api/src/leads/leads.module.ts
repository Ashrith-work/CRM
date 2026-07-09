import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { CompaniesModule } from '../companies/companies.module';
import { CustomersModule } from '../customers/customers.module';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';

@Module({
  // Convert reuses ContactsService + CompaniesService (CRM) and IdentityService
  // (commerce Customer find-or-create) for the lead→contact→customer flow.
  imports: [ContactsModule, CompaniesModule, CustomersModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
