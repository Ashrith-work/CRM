# Lead Pipeline / Tasks / Reminders / Notifications · Assumptions & Notes

## Scope decision: this milestone was ~90% already built
Reconnaissance found that M1 (Leads) and M3 (Tasks/Reminders/Notifications)
already implement almost all of this spec. Rebuilding would duplicate models and
break working, tested code — so I **filled the one genuine gap** and left the
rest intact. What already exists and meets the acceptance criteria:

- **Lead pipeline** — CRUD + status stages (`LeadStatus = NEW|CONTACTED|QUALIFIED|
  UNQUALIFIED|CONVERTED`), `source`, `ownerId`, `customFields`, tags, timeline
  (`ActivityEvent`), web `/dashboard/leads` (list/detail/new/edit). `apps/api/src/leads/*`.
- **Tasks / follow-ups** — `Task(type[TASK|FOLLOW_UP|MEETING|CALL], title,
  description, status[OPEN|DONE|CANCELLED], priority, dueAt, assigneeId,
  relatedType/relatedId, completedAt, outcome)`; `complete()` sets
  completedAt/outcome, cancels reminders, emits activity; `agenda` buckets
  overdue/today/upcoming in the assignee's tz; web `/dashboard/tasks/*`.
- **Restart-safe, exactly-once reminder engine** — `reminder-sweep.processor.ts`
  is a **repeatable BullMQ job (~60s, stable jobId)** that finds due `SCHEDULED`
  reminders and **atomically claims them (`updateMany SCHEDULED→SENT` before
  enqueue)** — the single-winner gate that guarantees no double-fire; a reminder
  due during a redeploy is a plain DB row and fires on the next sweep. The send
  processor resolves the recipient from `task.assigneeId` **at send time**
  (reassign follows) and **skips if the task is no longer OPEN** (done/cancelled
  suppressed). Already covered by `reminder-sweep/send/reminder.service` specs.
- **Notifications** — `NotificationService.fanOut` writes the durable
  `Notification` row (in-app) + emits over Socket.io to the user's room, sends
  EMAIL via the Resend adapter, records `deliveredChannels`; a `NotificationBell`
  + list + socket client already exist in the web. Exactly-once per channel is
  anchored by the reminder's atomic claim upstream.
- **Per-user timezone** — `User.timezone` + `PATCH /me/timezone` exist; used for
  agenda bucketing.

## The gap I built: Lead → Customer conversion
The existing `convert` created a CRM **Contact**; the spec wants a commerce
**Customer**. Added (additive — the contact flow is unchanged):
- **Schema/migration** (`20260718000000_lead_customer_conversion`): `Lead.convertedCustomerId`,
  `Lead.firstTouchTouchpointId`, and `InteractionType.LEAD`.
- **`LeadsService.convert`** now also **find-or-creates the commerce Customer by
  email/phone via M1 `IdentityService.resolveCustomer`** (deduped; it also
  re-attributes any Order/Cart/Event to the survivor), sets `convertedCustomerId`,
  **re-attributes the lead's first-touch `Touchpoint` to the customer** (so
  first-touch credit follows), and drops a **`LEAD` Interaction onto the customer
  360 timeline** (idempotent on org+type+refId) — so the lead shows on the
  customer timeline. The convert response gains `customer` + `customerCreated`.
- Web: the customer 360 timeline renders the new `LEAD` interaction (added the
  `lead` value to `INTERACTION_TYPES`, the timeline filter, and the icon map).

## Decisions / deferrals (honest scoping)
1. **Timezone reminders already fire at the right instant.** `dueAt` is stored as
   an absolute UTC instant and reminders fire at `anchor − minutesBefore` (also
   absolute), so "fires at the right time" holds regardless of the assignee's tz;
   the per-user tz is stored and used for agenda display. I did **not** add a
   wall-clock ("9am-local") reminder mode — the existing offset model is correct
   and well-tested; adding wall-clock scheduling would be new scope, not a fix.
2. **"Tasks show on the customer timeline" is partial.** Tasks relate to
   `CONTACT|COMPANY|LEAD|DEAL` (there is **no `CUSTOMER`** in `EntityType`) and
   emit `ActivityEvent` (the CRM timeline on the Lead/Contact), not `Interaction`
   (the commerce Customer 360 timeline). Leads now appear on the customer
   timeline (via the `LEAD` Interaction); unifying **task** activity onto the
   commerce-Customer 360 timeline would require adding `CUSTOMER` to `EntityType`
   and having tasks emit Interactions — deferred and flagged.
3. **Every conversion with an email/phone now also produces a commerce Customer.**
   Per the spec ("find-or-create Customer by email/phone"). Leads with neither
   identifier skip customer creation (no anonymous rows); `convertedCustomerId`
   stays null.
4. **Permissions unchanged.** `convert` is already `LEAD_MANAGE + CONTACT_MANAGE`
   (owner/admin), who also hold `COMMERCE_MANAGE`, so no new grant is needed.

## Tests
- New: `leads/leads-convert-customer.spec.ts` — find-or-create Customer (deduped),
  `convertedCustomerId` set, first-touch re-attribution, `LEAD` timeline
  Interaction, and the no-identifier skip.
- Existing (unchanged, still green): reminder sweep/send exactly-once + restart
  safety, notification fan-out, tasks service — under `tasks/*.spec.ts` and
  `notifications/notification.service.spec.ts`.

## Not done (per NON-GOALS)
No workflow builder, no external calendar sync, no mobile.
