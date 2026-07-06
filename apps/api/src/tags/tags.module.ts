import { Global, Module } from '@nestjs/common';
import { TagsService } from './tags.service';
import { TagsController } from './tags.controller';

/** Global so entity modules can reuse tag helpers (setEntityTags, etc.). */
@Global()
@Module({
  controllers: [TagsController],
  providers: [TagsService],
  exports: [TagsService],
})
export class TagsModule {}
