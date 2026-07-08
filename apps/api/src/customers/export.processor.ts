import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ExperienceExportService } from './experience-export.service';
import { EXPORT_QUEUE, type ExportJob } from './export.constants';

/**
 * Async Customer-Experience export worker: assembles the workbook (large single
 * history or a whole segment), stores it for download, and writes the audit
 * trail. Progress is surfaced via the JobStatus the panel polls.
 */
@Processor(EXPORT_QUEUE, { concurrency: 2 })
export class ExportProcessor extends WorkerHost {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(private readonly exports: ExperienceExportService) {
    super();
  }

  async process(job: Job<ExportJob>): Promise<{ ok: boolean }> {
    const jobId = job.id!;
    const { organizationId, actorUserId, customerIds, masked, filename } = job.data;
    await this.exports.setStatus(jobId, { state: 'running', ready: false, filename: null, error: null });
    try {
      const buffer = await this.exports.buildWorkbook(organizationId, customerIds, masked);
      await this.exports.storeFile(jobId, buffer);
      await this.exports.recordExport(organizationId, actorUserId, customerIds.length === 1 ? customerIds[0] : null, masked);
      await this.exports.setStatus(jobId, { state: 'completed', ready: true, filename, error: null });
      this.logger.log(`Export ${jobId} completed (${customerIds.length} customer(s))`);
      return { ok: true };
    } catch (err) {
      await this.exports.setStatus(jobId, { state: 'failed', ready: false, filename: null, error: (err as Error).message });
      throw err;
    }
  }
}
