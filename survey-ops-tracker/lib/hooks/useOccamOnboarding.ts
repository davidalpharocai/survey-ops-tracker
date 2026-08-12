'use client'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'

export interface RequestedByContact {
  id: string
  name: string
  email: string | null
  occam_invited: boolean
  /** Whether this contact has already had a prior delivered OCCAM project (so they
   *  already have an Occam account — a non-Occam prior delivery does NOT count). */
  hasPriorDelivery: boolean
}

/** The project's requested-by contact + their Occam-invited state (null if none set).
 *  Powers the delivery-time Occam onboarding gate. */
export function useRequestedByContact(contactId: string | null | undefined) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['requested-by-contact', contactId],
    queryFn: async (): Promise<RequestedByContact | null> => {
      const { data, error } = await supabase
        .from('client_contacts')
        .select('id, first_name, last_name, email, occam_invited')
        .eq('id', contactId!)
        .maybeSingle()
      if (error) throw error
      if (!data) return null

      // Prior delivery = any delivered OCCAM project for this contact (i.e. they
      // already got an Occam account on that delivery). MUST be scoped to
      // occam=true: a contact whose earlier delivery was a NON-Occam study has no
      // Occam account, so their first Occam delivery must still trigger the invite.
      // Not excluding the current project by id is fine: it isn't stage_delivery=true
      // until AFTER this transition, so it won't match here at gate time.
      const { data: prior, error: priorErr } = await supabase
        .from('survey_projects')
        .select('id')
        .eq('requested_by_contact_id', contactId!)
        .eq('stage_delivery', true)
        .eq('occam', true)
        .is('deleted_at', null)
        .limit(1)
      if (priorErr) throw priorErr

      return {
        id: data.id,
        name: `${data.first_name} ${data.last_name}`.trim(),
        email: data.email,
        occam_invited: !!data.occam_invited,
        hasPriorDelivery: (prior?.length ?? 0) > 0,
      }
    },
    enabled: !!contactId,
    staleTime: 15_000,
  })
}

/** Record that a contact was invited to Occam (welcome email sent), so the delivery
 *  gate stops prompting for them. */
export function useMarkOccamInvited() {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ contactId, invitedBy }: { contactId: string; invitedBy: string }) => {
      // .eq('occam_invited', false) makes this a no-op when the contact is ALREADY
      // invited, so re-confirming (e.g. from a stale/not-yet-loaded gate) never
      // overwrites the original occam_invited_at / occam_invited_by.
      const { error } = await supabase
        .from('client_contacts')
        .update({ occam_invited: true, occam_invited_at: new Date().toISOString(), occam_invited_by: invitedBy })
        .eq('id', contactId)
        .eq('occam_invited', false)
      if (error) throw error
    },
    onError: () => toast("Couldn't record the Occam invite — please try again."),
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['requested-by-contact', vars.contactId] })
      qc.invalidateQueries({ queryKey: ['client-contacts'] })
    },
  })
}
