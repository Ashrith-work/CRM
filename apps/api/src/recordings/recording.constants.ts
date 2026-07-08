/** BullMQ queue for async recording work (fetch/store + DPDP purge). */
export const RECORDING_FETCH_QUEUE = 'recording-fetch';

export interface FetchRecordingJob {
  type: 'fetch';
  callId: string;
}

/** DPDP erasure: purge all stored recordings for a contact (on consent withdrawal). */
export interface PurgeRecordingJob {
  type: 'purge';
  organizationId: string;
  contactId: string;
}

export type RecordingJob = FetchRecordingJob | PurgeRecordingJob;
