-- Intent-tracking states for Twilio number purchases. A row lands in
-- PENDING when the tenant starts the xPay checkout, flips to ACTIVE
-- after the Twilio IncomingPhoneNumber create succeeds, or to
-- PURCHASE_FAILED if Twilio refuses (the order is marked REFUND_PENDING
-- in parallel).
ALTER TYPE "TwilioPhoneNumberStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "TwilioPhoneNumberStatus" ADD VALUE IF NOT EXISTS 'PURCHASE_FAILED';
