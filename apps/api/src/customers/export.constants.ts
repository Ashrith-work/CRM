/** BullMQ queue for async Customer-Experience Excel assembly (large / segment). */
export const EXPORT_QUEUE = 'experience-export';

export interface ExportJob {
  organizationId: string;
  actorUserId: string;
  customerIds: string[];
  masked: boolean;
  filename: string;
}
