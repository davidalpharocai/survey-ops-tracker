import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { getCheckboxesForColumn, type BoardColumn } from '@/lib/utils/stage'
import { autoStamp } from '@/lib/utils/date'
import { toast } from '@/lib/utils/toast'
import type { Database } from '@/lib/supabase/types'

type ProjectRow = Database['public']['Tables']['survey_projects']['Row']
type ProjectUpdate = Database['public']['Tables']['survey_projects']['Update']

export type ProjectCaptain = {
  id: string
  name: string
  initials: string
}

/** Full row + captain join — what the detail page and CSV export work with. */
export type SurveyProject = ProjectRow & {
  captain: ProjectCaptain | null
}

// Only the columns the board, list, filters, and card chips actually read.
// Heavy/rarely-shown fields (linked_documents, slack_channel_url, budget,
// survey id sync columns, ...) are fetched per-project via useProject() or
// on demand via fetchFullProjects() for CSV export.
const SLIM_PROJECT_COLUMNS = [
  'id',
  'project_name',
  'client',
  'project_type',
  'phase',
  'status',
  'scoping_stage',
  'launch_date',
  'due_date',
  'n_target',
  'n_collected',
  'n_actual',
  'board_column',
  'latest_next_steps',
  'longitudinal',
  'voter_survey_qa',
  'citation_language_needed',
  'priority',
  'blocked_by',
  'stage_doc_programming',
  'stage_survey_programming',
  'stage_edwin_qa',
  'stage_fielding',
  'stage_data_qa',
  'stage_delivery',
  'captain_assigned_at',
  'captain_assigned_by',
  'sort_order',
  'created_at',
  'updated_at',
] as const

/** Slim row + captain join — what useProjects() returns for board/list views. */
export type SlimProject = Pick<ProjectRow, (typeof SLIM_PROJECT_COLUMNS)[number]> & {
  captain: ProjectCaptain | null
}

const CAPTAIN_JOIN = 'captain:team_members(id, name, initials)'
const SLIM_SELECT = `${SLIM_PROJECT_COLUMNS.join(', ')}, ${CAPTAIN_JOIN}`
const FULL_SELECT = `*, ${CAPTAIN_JOIN}`

export function useProjects() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select(SLIM_SELECT)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as SlimProject[]
    },
  })
}

/** Fetches one full project row (all columns) for the detail page. */
export function useProject(id: string) {
  const supabase = createClient()
  return useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select(FULL_SELECT)
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return data as unknown as SurveyProject | null
    },
    enabled: !!id,
    staleTime: 15_000,
  })
}

/**
 * One-off fetch of full rows (all columns) for the given project ids,
 * returned in the same order as `ids`. Used by the CSV export buttons so the
 * list views can stay on the slim select.
 */
export async function fetchFullProjects(ids: string[]): Promise<SurveyProject[]> {
  if (ids.length === 0) return []
  const supabase = createClient()
  const { data, error } = await supabase
    .from('survey_projects')
    .select(FULL_SELECT)
    .in('id', ids)
  if (error) throw error
  const byId = new Map((data as unknown as SurveyProject[]).map(p => [p.id, p]))
  return ids
    .map(id => byId.get(id))
    .filter((p): p is SurveyProject => p !== undefined)
}

// Updates apply to the UI instantly (optimistic) and reconcile with the
// database in the background; on failure the change rolls back.
export function useUpdateProject() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: ProjectUpdate
    }) => {
      const { error } = await supabase
        .from('survey_projects')
        .update(updates)
        .eq('id', id)
      if (error) throw error
    },
    onMutate: ({ id, updates }) => {
      // Cache writes happen SYNCHRONOUSLY (no await first) so the board
      // re-renders in the same tick as the drop — an await here lets the
      // drag library animate the card back to its source column first.
      const previousLists = queryClient.getQueriesData<SlimProject[]>({
        queryKey: ['projects'],
      })
      const previousDetail = queryClient.getQueryData<SurveyProject | null>([
        'project',
        id,
      ])
      queryClient.setQueriesData<SlimProject[]>({ queryKey: ['projects'] }, old =>
        old?.map(p => (p.id === id ? ({ ...p, ...updates } as SlimProject) : p))
      )
      queryClient.setQueryData<SurveyProject | null>(['project', id], old =>
        old ? ({ ...old, ...updates } as SurveyProject) : old
      )
      void queryClient.cancelQueries({ queryKey: ['projects'] })
      void queryClient.cancelQueries({ queryKey: ['project', id] })
      return { previousLists, previousDetail }
    },
    onError: (_err, { id }, context) => {
      for (const [key, data] of context?.previousLists ?? []) {
        queryClient.setQueryData(key, data)
      }
      if (context && context.previousDetail !== undefined) {
        queryClient.setQueryData(['project', id], context.previousDetail)
      }
      toast("Couldn't save that change — it was reverted.")
    },
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      queryClient.invalidateQueries({ queryKey: ['project', id] })
    },
  })
}

export function useDeleteProject() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('survey_projects')
        .delete()
        .eq('id', id)
      if (error) throw error
    },
    onMutate: id => {
      const previousLists = queryClient.getQueriesData<SlimProject[]>({
        queryKey: ['projects'],
      })
      queryClient.setQueriesData<SlimProject[]>({ queryKey: ['projects'] }, old =>
        old?.filter(p => p.id !== id)
      )
      void queryClient.cancelQueries({ queryKey: ['projects'] })
      return { previousLists }
    },
    onError: (_err, _id, context) => {
      for (const [key, data] of context?.previousLists ?? []) {
        queryClient.setQueryData(key, data)
      }
      toast("Couldn't delete the project — it was restored.")
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useMoveProjectToColumn() {
  const updateProject = useUpdateProject()
  return (id: string, column: BoardColumn, sortOrder?: number) => {
    const checkboxes = getCheckboxesForColumn(column)
    updateProject.mutate({
      id,
      updates: {
        board_column: column as Database['public']['Enums']['board_column'],
        ...checkboxes,
        ...(sortOrder !== undefined ? { sort_order: sortOrder } : {}),
      },
    })
  }
}

export function useAddProjectUpdate() {
  const updateProject = useUpdateProject()
  return (
    id: string,
    currentNotes: string | null,
    newText: string,
    userName: string
  ) => {
    const stamped = autoStamp(userName, currentNotes, newText)
    updateProject.mutate({ id, updates: { latest_next_steps: stamped } })
  }
}

export function useCreateProject() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (
      project: Database['public']['Tables']['survey_projects']['Insert']
    ) => {
      const { data, error } = await supabase
        .from('survey_projects')
        .insert(project)
        .select()
        .single()
      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}
