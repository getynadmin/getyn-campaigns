import { agentRouter } from './routers/agent';
import { automationRouter } from './routers/automation';
import { agentAttachmentsRouter } from './routers/agent-attachments';
import { emailVerifierRouter } from './routers/email-verifier';
import { aiRouter } from './routers/ai';
import { authRouter } from './routers/auth';
import { campaignsRouter } from './routers/campaigns';
import { contactsRouter } from './routers/contacts';
import { customFieldsRouter } from './routers/custom-fields';
import { emailAgentRouter } from './routers/email-agent';
import { emailAgentInboxRouter } from './routers/email-agent-inbox';
import { emailInboxRouter } from './routers/email-inbox';
import { emailTemplatesRouter } from './routers/email-templates';
import { eventsRouter } from './routers/events';
import { importsRouter } from './routers/imports';
import { invitationRouter } from './routers/invitation';
import { membershipRouter } from './routers/membership';
import { onboardingRouter } from './routers/onboarding';
import { pricingRouter } from './routers/pricing';
import { segmentsRouter } from './routers/segments';
import { sendingDomainsRouter } from './routers/sending-domains';
import { signupRouter } from './routers/signup';
import { subscriptionRouter } from './routers/subscription';
import { suppressionRouter } from './routers/suppression';
import { tagsRouter } from './routers/tags';
import { tenantRouter } from './routers/tenant';
import { tenantBrandRouter } from './routers/tenant-brand';
import { userSessionsRouter } from './routers/user-sessions';
import { whatsAppAccountsRouter } from './routers/whatsapp-accounts';
import { whatsAppCampaignsRouter } from './routers/whatsapp-campaigns';
import { whatsAppInboxRouter } from './routers/whatsapp-inbox';
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
  emailInbox: emailInboxRouter,
  campaign: campaignsRouter,
  // Phase 8 — Automation (Drip Campaigns)
  automation: automationRouter,
  // Phase 8 M4 — Email Agent config
  emailAgent: emailAgentRouter,
  emailAgentInbox: emailAgentInboxRouter,
  // Phase 4 — WhatsApp Business
  whatsAppAccount: whatsAppAccountsRouter,
  whatsAppPhoneNumber: whatsAppPhoneNumbersRouter,
  whatsAppTemplate: whatsAppTemplatesRouter,
  whatsAppCampaign: whatsAppCampaignsRouter,
  whatsAppInbox: whatsAppInboxRouter,
  // Phase 4 M7
  ai: aiRouter,
  // Phase 5 M2 — per-device session management
  userSessions: userSessionsRouter,
  // Phase 5.5 M5 — tenant subscription view + upgrade requests
  subscription: subscriptionRouter,
  // Phase 7 — AI Campaign Agents: brand profile (M1) + runtime (M2).
  tenantBrand: tenantBrandRouter,
  agent: agentRouter,
  // Phase 7.1 — attachment listing + signed-URL minting
  agentAttachments: agentAttachmentsRouter,
  // List-quality scanner under Audience → Email verifier
  emailVerifier: emailVerifierRouter,
  // Phase 9 — public /pricing surface
  pricing: pricingRouter,
});

export type AppRouter = typeof appRouter;

/** Used by server components / route handlers to invoke tRPC without HTTP. */
export const createCaller = createCallerFactory(appRouter);
