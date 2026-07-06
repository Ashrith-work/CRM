import { Module } from '@nestjs/common';
import { DealsService } from './deals.service';
import { DealsController } from './deals.controller';
import { BoardController } from './board.controller';

@Module({
  controllers: [DealsController, BoardController],
  providers: [DealsService],
  exports: [DealsService],
})
export class DealsModule {}
