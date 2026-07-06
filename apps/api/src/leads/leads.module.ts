import { Module } from '@nestjs/common';
import { ContactsModule } from '../contacts/contacts.module';
import { CompaniesModule } from '../companies/companies.module';
import { LeadsService } from './leads.service';
import { LeadsController } from './leads.controller';

@Module({
  // Convert reuses ContactsService + CompaniesService for creation/serialization.
  imports: [ContactsModule, CompaniesModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService],
})
export class LeadsModule {}
