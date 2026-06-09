export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      team_members: {
        Row: {
          id: string
          name: string
          initials: string
          email: string
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          initials: string
          email: string
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          initials?: string
          email?: string
          created_at?: string
        }
        Relationships: []
      }
      survey_projects: {
        Row: {
          id: string
          project_name: string
          client: string
          project_type: Database['public']['Enums']['project_type'] | null
          captain_id: string | null
          phase: Database['public']['Enums']['project_phase']
          status: Database['public']['Enums']['project_status']
          scoping_stage: Database['public']['Enums']['scoping_stage'] | null
          submitted_date: string | null
          launch_date: string | null
          due_date: string | null
          deliver_date: string | null
          n_target: number | null
          n_collected: number
          n_last_synced: string | null
          audience_size: number | null
          row_level_data: boolean
          terminations: boolean
          stage_doc_programming: boolean
          stage_survey_programming: boolean
          stage_edwin_qa: boolean
          stage_fielding: boolean
          stage_data_qa: boolean
          stage_delivery: boolean
          board_column: Database['public']['Enums']['board_column']
          latest_next_steps: string | null
          linked_documents: string[]
          calendar_event_id: string | null
          survey_tool_id: string | null
          budget: number | null
          actual_spend: number | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_name: string
          client: string
          project_type?: Database['public']['Enums']['project_type'] | null
          captain_id?: string | null
          phase?: Database['public']['Enums']['project_phase']
          status?: Database['public']['Enums']['project_status']
          scoping_stage?: Database['public']['Enums']['scoping_stage'] | null
          submitted_date?: string | null
          launch_date?: string | null
          due_date?: string | null
          deliver_date?: string | null
          n_target?: number | null
          n_collected?: number
          n_last_synced?: string | null
          audience_size?: number | null
          row_level_data?: boolean
          terminations?: boolean
          stage_doc_programming?: boolean
          stage_survey_programming?: boolean
          stage_edwin_qa?: boolean
          stage_fielding?: boolean
          stage_data_qa?: boolean
          stage_delivery?: boolean
          board_column?: Database['public']['Enums']['board_column']
          latest_next_steps?: string | null
          linked_documents?: string[]
          calendar_event_id?: string | null
          survey_tool_id?: string | null
          budget?: number | null
          actual_spend?: number | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_name?: string
          client?: string
          project_type?: Database['public']['Enums']['project_type'] | null
          captain_id?: string | null
          phase?: Database['public']['Enums']['project_phase']
          status?: Database['public']['Enums']['project_status']
          scoping_stage?: Database['public']['Enums']['scoping_stage'] | null
          submitted_date?: string | null
          launch_date?: string | null
          due_date?: string | null
          deliver_date?: string | null
          n_target?: number | null
          n_collected?: number
          n_last_synced?: string | null
          audience_size?: number | null
          row_level_data?: boolean
          terminations?: boolean
          stage_doc_programming?: boolean
          stage_survey_programming?: boolean
          stage_edwin_qa?: boolean
          stage_fielding?: boolean
          stage_data_qa?: boolean
          stage_delivery?: boolean
          board_column?: Database['public']['Enums']['board_column']
          latest_next_steps?: string | null
          linked_documents?: string[]
          calendar_event_id?: string | null
          survey_tool_id?: string | null
          budget?: number | null
          actual_spend?: number | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'survey_projects_captain_id_fkey'
            columns: ['captain_id']
            isOneToOne: false
            referencedRelation: 'team_members'
            referencedColumns: ['id']
          }
        ]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: {
      project_type: 'PS' | 'B2B' | 'Rerun'
      project_status: 'Open' | 'Closed'
      project_phase: 'Scoping' | 'Active'
      board_column:
        | 'Submitted'
        | 'Doc Programming'
        | 'Survey Programming'
        | 'EdWin QA'
        | 'Fielding'
        | 'Data QA'
        | 'Delivery'
      scoping_stage:
        | 'New Inquiry'
        | 'Proposal Sent'
        | 'Pricing Discussion'
        | 'Awaiting Approval'
        | 'Closed'
    }
    CompositeTypes: Record<string, never>
  }
}

// Convenience type aliases
export type Tables<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row']
export type TablesInsert<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Insert']
export type TablesUpdate<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Update']
export type Enums<T extends keyof Database['public']['Enums']> =
  Database['public']['Enums'][T]

// Specific row types
export type TeamMember = Tables<'team_members'>
export type SurveyProject = Tables<'survey_projects'>

// Enum types
export type ProjectType = Enums<'project_type'>
export type ProjectStatus = Enums<'project_status'>
export type ProjectPhase = Enums<'project_phase'>
export type BoardColumn = Enums<'board_column'>
export type ScopingStage = Enums<'scoping_stage'>
