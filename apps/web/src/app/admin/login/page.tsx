/**
 * Phase 5 M7 — /admin/login.
 *
 * Two paths to a staff session:
 *   - Auth0 with `is_getyn_staff: true` claim (preferred). The
 *     callback issues a staff cookie when it sees that claim AND
 *     finds a matching StaffUser row.
 *   - Phase 1 password fallback (kept off in prod by default — gated
 *     by STAFF_PASSWORD_AUTH_ENABLED). Useful when Auth0 is down or
 *     for development.
 *
 * The page is intentionally simple — no marketing, no copy, just the
 * two buttons. Staff should never reach this page from a public link;
 * unauthenticated probes get 404 from the layout above.
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

export default function StaffLoginPage(): JSX.Element {
  const ssoAvailable = isAuth0Configured();
  const passwordEnabled =
    process.env.STAFF_PASSWORD_AUTH_ENABLED === 'true';

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
          {passwordEnabled && (
            <div className="rounded-md border border-dashed bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Password fallback is enabled in this environment. Use the
              main <Link href="/login" className="underline">customer login</Link>
              {' '}with a staff-eligible email; the callback grants a staff
              cookie when it finds your email in <code>StaffUser</code>.
            </div>
          )}
          {!ssoAvailable && !passwordEnabled && (
            <div className="rounded-md border border-dashed p-4 text-center text-sm">
              <p className="font-medium">No staff sign-in path is configured.</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Set Auth0 credentials or{' '}
                <code className="rounded bg-muted px-1">
                  STAFF_PASSWORD_AUTH_ENABLED=true
                </code>
                .
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
