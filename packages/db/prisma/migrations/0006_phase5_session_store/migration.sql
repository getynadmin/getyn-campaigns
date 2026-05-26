-- Phase 5 M2 — per-device session store.
-- Lets us list "your active sessions" in user settings and revoke
-- remote devices in real time. Stateless JWT cookies can't be
-- revoked until they expire; the session-store row check we add to
-- verifyAuth0SessionCookie closes that gap.

CREATE TABLE "UserSession" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "sessionToken" TEXT NOT NULL,
  "provider"     "AuthProvider" NOT NULL,
  "deviceLabel"  TEXT,
  "ipAddress"    TEXT,
  "userAgent"    TEXT,
  "issuedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "lastSeenAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"    TIMESTAMP(3),
  CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserSession_sessionToken_key" ON "UserSession"("sessionToken");
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

ALTER TABLE "UserSession"
  ADD CONSTRAINT "UserSession_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS: tenant queries should never touch UserSession directly. The
-- tRPC userSession router uses the service-role client. Defense in
-- depth via DENY ALL.
ALTER TABLE "UserSession" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "UserSession_deny_authenticated" ON "UserSession"
  FOR ALL TO authenticated USING (false);
