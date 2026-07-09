import { Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { GroundingService } from './grounding.service';
import { ASSISTANT_QUEUE, EMBED_GLOSSARY_JOB } from './assistant.constants';

/**
 * Embeds the glossary definitions into pgvector so the assistant can retrieve +
 * cite them. Runs once shortly after boot (idempotent: only rewrites when the
 * glossary version/content changed) and daily thereafter, so a bumped glossary
 * re-embeds without a deploy.
 */
@Processor(ASSISTANT_QUEUE, { concurrency: 1 })
export class EmbedGlossaryProcessor extends WorkerHost implements OnModuleInit {
  private readonly logger = new Logger(EmbedGlossaryProcessor.name);
  private static readonly DAY_MS = 24 * 60 * 60 * 1000;

  constructor(
    private readonly grounding: GroundingService,
    @InjectQueue(ASSISTANT_QUEUE) private readonly queue: Queue,
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.queue.add(EMBED_GLOSSARY_JOB, {}, { jobId: 'embed-glossary-boot', delay: 15_000, removeOnComplete: true, removeOnFail: 5 });
    await this.queue.add(
      EMBED_GLOSSARY_JOB,
      {},
      { jobId: 'embed-glossary-repeat', repeat: { every: EmbedGlossaryProcessor.DAY_MS }, removeOnComplete: true, removeOnFail: 5 },
    );
    this.logger.log('Glossary embedding scheduled (boot + daily)');
  }

  async process(): Promise<{ embedded: number }> {
    const embedded = await this.grounding.embedGlossary();
    return { embedded };
  }
}
