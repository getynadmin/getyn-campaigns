import { aiRouter } from './routers/ai';
import { authRouter } from './routers/auth';
import { campaignsRouter } from './routers/campaigns';
import { contactsRouter } from './routers/contacts';
import { customFieldsRouter } from './routers/custom-fields';
import { emailTemplatesRouter } from './routers/email-templates';
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
import { whatsAppAccountsRouter } from './routers/whatsapp-accounts';
import { whatsAppPhoneNumbersRouter } from './routers/whatsapp-phone-numbers';
import { whatsAppTemplatesRouter } from './routers/whatsapp-templates';
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
  emailTemplate: emailTemplatesRouter,
  campaign: campaignsRouter,
  // Phase 4 — WhatsApp Business
  whatsAppAccount: whatsAppAccountsRouter,
  whatsAppPhoneNumber: whatsAppPhoneNumbersRouter,
  whatsAppTemplate: whatsAppTemplatesRouter,
  // Phase 4 M7
  ai: aiRouter,
});

export type AppRouter = typeof appRouter;

/** Used by server components / route handlers to invoke tRPC without HTTP. */
export const createCaller = createCallerFactory(appRouter);
