-- Extend NotificationKind with the two SMS-channel events.
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'SMS_NUMBER_PURCHASED';
ALTER TYPE "NotificationKind" ADD VALUE IF NOT EXISTS 'SMS_SENDER_ID_APPROVED';
