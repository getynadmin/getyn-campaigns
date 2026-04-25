import { authRouter } from './routers/auth';
import { contactsRouter } from './routers/contacts';
import { customFieldsRouter } from './routers/custom-fields';
import { eventsRouter } from './routers/events';
import { importsRouter } from './routers/imports';
import { invitationRouter } from './routers/invitation';
import { membershipRouter } from './routers/membership';
import { onboardingRouter } from './routers/onboarding';
import { segmentsRouter } from './routers/segments';
import { sendingDomainsRouter } from './routers/sending-domains';
import { signupRouter } from './routers/signup';
import { suppressionRouter } from './routers/suppression';
import { tagsRouter } from './routers/tags';
import { tenantRouter } from './routers/tenant';
import { createCallerFactory, createTRPCRouter } from './trpc';

export const appRouter = createTRPCRouter({
  auth: authRouter,
  signup: signupRouter,
  onboarding: onboardingRouter,
  tenant: tenantRouter,
  membership: membershipRouter,
  invitation: invitationRouter,
  contacts: contactsRouter,
  tags: tagsRouter,
  customFields: customFieldsRouter,
  imports: importsRouter,
  segments: segmentsRouter,
  events: eventsRouter,
  suppression: suppressionRouter,
  sendingDomain: sendingDomainsRouter,
});

export type AppRouter = typeof appRouter;

/** Used by server components / route handlers to invoke tRPC without HTTP. */
export const createCaller = createCallerFactory(appRouter);
