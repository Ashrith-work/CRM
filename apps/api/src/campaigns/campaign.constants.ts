/** BullMQ queue for the abandoned-cart recovery sweeps (enroll + send). */
export const CAMPAIGN_QUEUE = 'campaigns';
export const ENROLL_JOB_ID = 'campaign-enroll-repeat';
export const SEND_JOB_ID = 'campaign-send-repeat';

export interface CampaignSweepJob {
  type: 'enroll' | 'send';
}
