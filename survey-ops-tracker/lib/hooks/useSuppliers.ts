import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/lib/utils/toast'
import type { Tables } from '@/lib/supabase/types'

export type Supplier = Tables<'suppliers'>

// Global catalog of PureSpectrum sample suppliers. Analyst-editable.
export function useSuppliers() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['suppliers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('suppliers').select('*').eq('active', true).order('name')
      if (error) throw error
      return data as Supplier[]
    },
    retry: false, // table absent pre-migration → show the fallback, don't spin
    staleTime: 5 * 60_000,
  })
}

export function useAddSupplier() {
  const supabase = createClient()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ name, createdBy }: { name: string; createdBy: string }) => {
      const { data, error } = await supabase
        .from('suppliers')
        .insert({ name, created_by: createdBy })
        .select('*')
        .single()
      if (error) throw error
      return data as Supplier
    },
    onError: () => toast("Couldn't add the supplier — it may already exist."),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  })
}
