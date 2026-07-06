import { Global, Module } from '@nestjs/common';
import { StagesService } from './stages.service';
import { StagesController } from './stages.controller';

/** Global so PipelinesService/DealsService can reuse StagesService + serializeStage. */
@Global()
@Module({
  controllers: [StagesController],
  providers: [StagesService],
  exports: [StagesService],
})
export class StagesModule {}
