/**
 * Phase 5.5 M1 — /admin/login.
 *
 * Two paths to a staff session:
 *   - Auth0 with `is_getyn_staff: true` claim (when SSO is wired up).
 *     The callback issues a staff cookie when it sees that claim AND
 *     finds a matching StaffUser row.
 *   - Email/password via the main customer /login. The same callback
 *     grants a staff cookie when the email matches a StaffUser row.
 *     This is no longer gated — it's the primary path now that
 *     G-Suite integration is paused.
 *
 * Staff should never reach this page from a public link; unauthenticated
 * probes get 404 from the layout above.
 */
import Link from 'next/link';
import { ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { isAuth0Configured } from '@/server/auth/auth0';

export const metadata = { title: 'Staff sign-in' };

// Read env at request time — AUTH0_* are toggled in Vercel without
// code changes.
export const dynamic = 'force-dynamic';

export default function StaffLoginPage(): JSX.Element {
  const ssoAvailable = isAuth0Configured();

  return (
    <main className="grid min-h-dvh place-items-center bg-muted/30 px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-rose-600" />
            Staff sign-in
          </CardTitle>
          <CardDescription>
            Internal-only. If you arrived here by accident, return to{' '}
            <Link href="/" className="underline">
              getyn.com
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {ssoAvailable && (
            <Button asChild className="w-full" size="lg">
              <a href="/api/auth/login/auth0?return_to=/admin/tenants">
                Sign in via G-Suite SSO
              </a>
            </Button>
          )}
          <div className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Or use the main{' '}
            <Link href="/login" className="underline">
              customer login
            </Link>{' '}
            with a staff-eligible email — the callback grants a staff cookie
            when it finds your email in <code>StaffUser</code>.
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
