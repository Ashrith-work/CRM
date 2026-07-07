/** BullMQ queue names for the reminder engine. */
export const REMINDER_SWEEP_QUEUE = 'reminder-sweep';
export const REMINDER_SEND_QUEUE = 'reminder-send';

/** Stable id for the single repeatable sweep job (prevents duplicates on restart). */
export const SWEEP_JOB_ID = 'reminder-sweep-repeat';

/** Max reminders claimed per sweep tick. */
export const SWEEP_BATCH = 500;

/** Send-worker concurrency (throttles a storm of simultaneous reminders). */
export const SEND_CONCURRENCY = Number(process.env.REMINDER_SEND_CONCURRENCY ?? 10);

export interface ReminderSendJob {
  reminderId: string;
}
