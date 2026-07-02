import { z } from 'zod'

export const RdapEventSchema = z.object({
  eventAction: z.string(),
  eventDate: z.string().optional(),
})

export const RdapResponseSchema = z.object({
  events: z.array(RdapEventSchema).optional(),
})

export interface RdapDates {
  expirationDate: string | null
  renewalDate: string | null
}
