import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { getCheckboxesForColumn, type BoardColumn } from '@/lib/utils/stage'
import { autoStamp } from '@/lib/utils/date'
import type { Database } from '@/lib/supabase/types'

export type SurveyProject = Database['public']['Tables']['survey_projects']['Row'] & {
  captain: {
    id: string
    name: string
    initials: string
  } | null
}

export function useProjects() {
  const supabase = createClient()
  return useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_projects')
        .select('*, captain:team_members(id, name, initials)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as SurveyProject[]
    },
  })
}

export function useUpdateProject() {
  const supabase = createClient()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string
      updates: Database['public']['Tables']['survey_projects']['Update']
    }) => {
      const { error } = await supabase
        .from('survey_projects')
        .update(updates)
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
    },
  })
}

export function useMoveProjectToColumn() {
  const updateProject = useUpdateProject()
  return (id: string, column: BoardColumn) => {
    const checkboxes = getCheckboxesForColumn(column)
    updateProject.mutate({
      id,
      updates: {
        board_column: column as Database['public']['Enums']['board_column'],
        ...checkboxes,
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
