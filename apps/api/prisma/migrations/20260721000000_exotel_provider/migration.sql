-- Exotel as a swap-able telephony provider: map inbound Exotel webhooks to an org.
ALTER TABLE "Organization" ADD COLUMN "exotelAccountSid" TEXT;
CREATE UNIQUE INDEX "Organization_exotelAccountSid_key" ON "Organization" ("exotelAccountSid");
