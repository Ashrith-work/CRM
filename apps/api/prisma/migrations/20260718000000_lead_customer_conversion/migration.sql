-- Lead → Customer conversion (find-or-create commerce Customer via identity
-- resolution) + source attribution link.

-- AlterEnum: leads land on the customer 360 timeline as a LEAD interaction.
ALTER TYPE "InteractionType" ADD VALUE 'LEAD';

-- AlterTable: the converted commerce Customer + the first-touch source link.
ALTER TABLE "Lead" ADD COLUMN "convertedCustomerId" TEXT;
ALTER TABLE "Lead" ADD COLUMN "firstTouchTouchpointId" TEXT;
