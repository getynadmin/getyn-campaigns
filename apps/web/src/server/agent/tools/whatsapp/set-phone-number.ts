import { z } from 'zod';

import { defineTool } from '@getyn/ai';
import { prisma } from '@getyn/db';
import { cuidSchema } from '@getyn/types';

import type { WhatsAppAgentPhoneRef } from './state';

/**
 * Pick which connected phone number to send from. If the tenant has
 * exactly one connected number, the system prompt already mentions it
 * and Claude can just call this once; with multiple, the agent should
 * ask the user.
 */
export const setPhoneNumberTool = defineTool({
  name: 'set_phone_number',
  description:
    "Pick which connected WhatsApp phone number to send from. The id must match one of the phone numbers listed in the system prompt.",
  inputSchema: z.object({
    phoneNumberId: cuidSchema,
  }),
  outputSchema: z.object({
    ok: z.literal(true),
    phoneNumber: z.string(),
    verifiedName: z.string(),
  }),
  async handler(input, ctx) {
    const phone = await prisma.whatsAppPhoneNumber.findFirst({
      where: { id: input.phoneNumberId, tenantId: ctx.tenantId },
      select: {
        id: true,
        phoneNumber: true,
        verifiedName: true,
        displayPhoneNumberStatus: true,
      },
    });
    if (!phone) {
      throw new Error(
        `Phone number ${input.phoneNumberId} not found in this workspace.`,
      );
    }
    const ref: WhatsAppAgentPhoneRef = {
      phoneNumberId: phone.id,
      phoneNumber: phone.phoneNumber,
      verifiedName: phone.verifiedName,
    };
    ctx.updateState({ phoneNumber: ref });
    return {
      ok: true as const,
      phoneNumber: phone.phoneNumber,
      verifiedName: phone.verifiedName,
    };
  },
});
