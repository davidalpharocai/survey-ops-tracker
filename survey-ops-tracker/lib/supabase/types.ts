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
      sprint_config: {
        Row: { id: number; anchor_date: string; length_days: number }
        Insert: { id?: number; anchor_date: string; length_days?: number }
        Update: { id?: number; anchor_date?: string; length_days?: number }
        Relationships: []
      }
      project_segments: {
        Row: {
          id: string
          project_id: string
          label: string
          n_target: number | null
          n_collected: number
          n_actual: number | null
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          label: string
          n_target?: number | null
          n_collected?: number
          n_actual?: number | null
          sort_order?: number
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          label?: string
          n_target?: number | null
          n_collected?: number
          n_actual?: number | null
          sort_order?: number
          created_at?: string
        }
        Relationships: []
      }
      app_config: {
        Row: { id: number; ai_monthly_cap_usd: number; ai_hard_stop: boolean; updated_at: string }
        Insert: { id?: number; ai_monthly_cap_usd?: number; ai_hard_stop?: boolean; updated_at?: string }
        Update: { id?: number; ai_monthly_cap_usd?: number; ai_hard_stop?: boolean; updated_at?: string }
        Relationships: []
      }
      ai_usage: {
        Row: {
          id: string
          created_at: string
          endpoint: string
          user_email: string | null
          model: string
          input_tokens: number
          output_tokens: number
          cache_read_tokens: number
          cache_creation_tokens: number
          cost_usd: number
        }
        Insert: {
          id?: string
          created_at?: string
          endpoint: string
          user_email?: string | null
          model: string
          input_tokens?: number
          output_tokens?: number
          cache_read_tokens?: number
          cache_creation_tokens?: number
          cost_usd?: number
        }
        Update: {
          id?: string
          created_at?: string
          endpoint?: string
          user_email?: string | null
          model?: string
          input_tokens?: number
          output_tokens?: number
          cache_read_tokens?: number
          cache_creation_tokens?: number
          cost_usd?: number
        }
        Relationships: []
      }
      system_events: {
        Row: {
          id: string
          created_at: string
          source: string
          status: string
          detail: string | null
          meta: Record<string, unknown> | null
        }
        Insert: {
          id?: string
          created_at?: string
          source: string
          status?: string
          detail?: string | null
          meta?: Record<string, unknown> | null
        }
        Update: {
          id?: string
          created_at?: string
          source?: string
          status?: string
          detail?: string | null
          meta?: Record<string, unknown> | null
        }
        Relationships: []
      }
      project_audit: {
        Row: {
          id: string
          project_id: string
          field: string
          old_value: string | null
          new_value: string | null
          changed_by: string
          changed_at: string
        }
        Insert: {
          id?: string
          project_id: string
          field: string
          old_value?: string | null
          new_value?: string | null
          changed_by?: string
          changed_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          field?: string
          old_value?: string | null
          new_value?: string | null
          changed_by?: string
          changed_at?: string
        }
        Relationships: []
      }
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
          audience: string | null
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
          client_id: string | null
          budget: number | null
          actual_spend: number | null
          longitudinal: boolean
          salesperson: string | null
          voter_survey_qa: boolean | null
          citation_language_needed: boolean | null
          n_actual: number | null
          slack_channel_url: string | null
          survey_ids_from_sheet: string | null
          survey_ids_synced_at: string | null
          priority: string
          blocked_by: string
          survey_id_discrepancy: string | null
          captain_assigned_at: string | null
          captain_assigned_by: string | null
          sort_order: number | null
          co_captain_ids: string[] | null
          project_code: string | null
          drive_folder_id: string | null
          deleted_at: string | null
          delivered_at: string | null
          category: string | null
          objective: string | null
          sprint_number: number | null
          compliance_override: boolean | null
          segment_count: number
          rerun_date: string | null
          rerun_number: number
          rerun_series_id: string | null
          rerun_spawned_at: string | null
          requested_by_contact_id: string | null
          requested_by_name: string | null
          n_internal_target: number | null
          created_at: string
          updated_at: string
          sheet_synced_at: string | null
          sheet_synced_hash: string | null
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
          audience?: string | null
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
          client_id?: string | null
          budget?: number | null
          actual_spend?: number | null
          longitudinal?: boolean
          salesperson?: string | null
          voter_survey_qa?: boolean | null
          citation_language_needed?: boolean | null
          n_actual?: number | null
          slack_channel_url?: string | null
          survey_ids_from_sheet?: string | null
          survey_ids_synced_at?: string | null
          priority?: string
          blocked_by?: string
          survey_id_discrepancy?: string | null
          captain_assigned_at?: string | null
          captain_assigned_by?: string | null
          sort_order?: number | null
          co_captain_ids?: string[] | null
          project_code?: string | null
          drive_folder_id?: string | null
          deleted_at?: string | null
          delivered_at?: string | null
          category?: string | null
          objective?: string | null
          sprint_number?: number | null
          compliance_override?: boolean | null
          segment_count?: number
          rerun_date?: string | null
          rerun_number?: number
          rerun_series_id?: string | null
          rerun_spawned_at?: string | null
          requested_by_contact_id?: string | null
          requested_by_name?: string | null
          n_internal_target?: number | null
          created_at?: string
          updated_at?: string
          sheet_synced_at?: string | null
          sheet_synced_hash?: string | null
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
          audience?: string | null
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
          client_id?: string | null
          budget?: number | null
          actual_spend?: number | null
          longitudinal?: boolean
          salesperson?: string | null
          voter_survey_qa?: boolean | null
          citation_language_needed?: boolean | null
          n_actual?: number | null
          slack_channel_url?: string | null
          survey_ids_from_sheet?: string | null
          survey_ids_synced_at?: string | null
          priority?: string
          blocked_by?: string
          survey_id_discrepancy?: string | null
          captain_assigned_at?: string | null
          captain_assigned_by?: string | null
          sort_order?: number | null
          co_captain_ids?: string[] | null
          project_code?: string | null
          drive_folder_id?: string | null
          deleted_at?: string | null
          delivered_at?: string | null
          category?: string | null
          objective?: string | null
          sprint_number?: number | null
          compliance_override?: boolean | null
          segment_count?: number
          rerun_date?: string | null
          rerun_number?: number
          rerun_series_id?: string | null
          rerun_spawned_at?: string | null
          requested_by_contact_id?: string | null
          requested_by_name?: string | null
          n_internal_target?: number | null
          created_at?: string
          updated_at?: string
          sheet_synced_at?: string | null
          sheet_synced_hash?: string | null
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
      clients: {
        Row: {
          id: string
          name: string
          code: string | null
          drive_folder_id: string | null
          compliance_before_fielding: boolean
          compliance_after_fielding: boolean
          compliance_contact: string | null
          compliance_notes: string | null
          created_at: string
          deleted_at: string | null
        }
        Insert: {
          id?: string
          name: string
          code?: string | null
          drive_folder_id?: string | null
          compliance_before_fielding?: boolean
          compliance_after_fielding?: boolean
          compliance_contact?: string | null
          compliance_notes?: string | null
          created_at?: string
          deleted_at?: string | null
        }
        Update: {
          id?: string
          name?: string
          code?: string | null
          drive_folder_id?: string | null
          compliance_before_fielding?: boolean
          compliance_after_fielding?: boolean
          compliance_contact?: string | null
          compliance_notes?: string | null
          created_at?: string
          deleted_at?: string | null
        }
        Relationships: []
      }
      client_contacts: {
        Row: {
          id: string
          client_id: string
          first_name: string
          last_name: string
          email: string | null
          title: string | null
          phone: string | null
          archived: boolean
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          first_name: string
          last_name: string
          email?: string | null
          title?: string | null
          phone?: string | null
          archived?: boolean
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          first_name?: string
          last_name?: string
          email?: string | null
          title?: string | null
          phone?: string | null
          archived?: boolean
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      client_notes: {
        Row: {
          id: string
          client_id: string
          body: string
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          body: string
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string
          body?: string
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          email: string
          full_name: string | null
          role: Database['public']['Enums']['profile_role']
          client_id: string | null
          created_at: string
        }
        Insert: {
          id: string
          email: string
          full_name?: string | null
          role?: Database['public']['Enums']['profile_role']
          client_id?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          full_name?: string | null
          role?: Database['public']['Enums']['profile_role']
          client_id?: string | null
          created_at?: string
        }
        Relationships: []
      }
      question_submissions: {
        Row: {
          id: string
          project_id: string
          version: number
          status: Database['public']['Enums']['submission_status']
          source_file_name: string
          source_file_path: string
          submitted_by: string | null
          submitted_at: string
          reviewed_by: string | null
          reviewed_at: string | null
          review_note: string | null
          analyst_message: string | null
          dispatched_at: string | null
          phase: string
          results_url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          version: number
          status?: Database['public']['Enums']['submission_status']
          source_file_name: string
          source_file_path: string
          submitted_by?: string | null
          submitted_at?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_note?: string | null
          analyst_message?: string | null
          dispatched_at?: string | null
          phase?: string
          results_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          version?: number
          status?: Database['public']['Enums']['submission_status']
          source_file_name?: string
          source_file_path?: string
          submitted_by?: string | null
          submitted_at?: string
          reviewed_by?: string | null
          reviewed_at?: string | null
          review_note?: string | null
          analyst_message?: string | null
          dispatched_at?: string | null
          phase?: string
          results_url?: string | null
          created_at?: string
        }
        Relationships: []
      }
      questions: {
        Row: {
          id: string
          submission_id: string
          order_num: number
          text: string
          type: Database['public']['Enums']['question_type']
          is_open_text: boolean
          is_ai_followup: boolean
          section: string | null
          answer_options: Json
        }
        Insert: {
          id?: string
          submission_id: string
          order_num: number
          text: string
          type?: Database['public']['Enums']['question_type']
          is_open_text?: boolean
          is_ai_followup?: boolean
          section?: string | null
          answer_options?: Json
        }
        Update: {
          id?: string
          submission_id?: string
          order_num?: number
          text?: string
          type?: Database['public']['Enums']['question_type']
          is_open_text?: boolean
          is_ai_followup?: boolean
          section?: string | null
          answer_options?: Json
        }
        Relationships: []
      }
      project_recipients: {
        Row: {
          id: string
          project_id: string
          email: string
          name: string | null
          role: Database['public']['Enums']['recipient_role']
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          email: string
          name?: string | null
          role: Database['public']['Enums']['recipient_role']
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          email?: string
          name?: string | null
          role?: Database['public']['Enums']['recipient_role']
          created_at?: string
        }
        Relationships: []
      }
      project_activity: {
        Row: {
          id: string
          project_id: string
          type: string
          direction: string | null
          sender: string | null
          recipients: string | null
          subject: string | null
          snippet: string | null
          body: string | null
          occurred_at: string
          source: string | null
          external_id: string | null
          deleted_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          type?: string
          direction?: string | null
          sender?: string | null
          recipients?: string | null
          subject?: string | null
          snippet?: string | null
          body?: string | null
          occurred_at?: string
          source?: string | null
          external_id?: string | null
          deleted_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          type?: string
          direction?: string | null
          sender?: string | null
          recipients?: string | null
          subject?: string | null
          snippet?: string | null
          body?: string | null
          occurred_at?: string
          source?: string | null
          external_id?: string | null
          deleted_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      project_bids: {
        Row: {
          id: string
          project_id: string
          amount: number
          blasts: number | null
          note: string | null
          created_by: string | null
          idem_key: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          amount: number
          blasts?: number | null
          note?: string | null
          created_by?: string | null
          idem_key?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          amount?: number
          blasts?: number | null
          note?: string | null
          created_by?: string | null
          idem_key?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'project_bids_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'survey_projects'
            referencedColumns: ['id']
          }
        ]
      }
      project_blasts: {
        Row: {
          id: string
          project_id: string
          delivered: number
          bid: number
          blast_cost: number
          reward: number
          scheduled_at: string | null
          status: string
          note: string | null
          created_by: string | null
          idem_key: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          delivered?: number
          bid?: number
          blast_cost?: number
          reward?: number
          scheduled_at?: string | null
          status?: string
          note?: string | null
          created_by?: string | null
          idem_key?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          delivered?: number
          bid?: number
          blast_cost?: number
          reward?: number
          scheduled_at?: string | null
          status?: string
          note?: string | null
          created_by?: string | null
          idem_key?: string | null
          created_at?: string
        }
        Relationships: []
      }
      suppliers: {
        Row: { id: string; name: string; active: boolean; created_by: string | null; created_at: string }
        Insert: { id?: string; name: string; active?: boolean; created_by?: string | null; created_at?: string }
        Update: { id?: string; name?: string; active?: boolean; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      project_suppliers: {
        Row: {
          id: string
          project_id: string
          supplier_id: string
          cpi: number
          completes_cap: number
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          supplier_id: string
          cpi?: number
          completes_cap?: number
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          supplier_id?: string
          cpi?: number
          completes_cap?: number
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }
      project_steps: {
        Row: {
          id: string
          project_id: string
          text: string
          done: boolean
          created_by: string | null
          created_at: string
          completed_at: string | null
          completed_by: string | null
        }
        Insert: {
          id?: string
          project_id: string
          text: string
          done?: boolean
          created_by?: string | null
          created_at?: string
          completed_at?: string | null
          completed_by?: string | null
        }
        Update: {
          id?: string
          project_id?: string
          text?: string
          done?: boolean
          created_by?: string | null
          created_at?: string
          completed_at?: string | null
          completed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: 'project_steps_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'survey_projects'
            referencedColumns: ['id']
          }
        ]
      }
      project_data_changes: {
        Row: {
          id: string
          project_id: string
          text: string
          created_by: string | null
          created_at: string
          edited_at: string | null
        }
        Insert: {
          id?: string
          project_id: string
          text: string
          created_by?: string | null
          created_at?: string
          edited_at?: string | null
        }
        Update: {
          id?: string
          project_id?: string
          text?: string
          created_by?: string | null
          created_at?: string
          edited_at?: string | null
        }
        Relationships: []
      }
      project_seen: {
        Row: {
          project_id: string
          user_email: string
          seen_at: string
        }
        Insert: {
          project_id: string
          user_email: string
          seen_at?: string
        }
        Update: {
          project_id?: string
          user_email?: string
          seen_at?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          id: string
          submission_id: string | null
          recipient_email: string
          template: string
          resend_id: string | null
          sent_at: string
        }
        Insert: {
          id?: string
          submission_id?: string | null
          recipient_email: string
          template: string
          resend_id?: string | null
          sent_at?: string
        }
        Update: {
          id?: string
          submission_id?: string | null
          recipient_email?: string
          template?: string
          resend_id?: string | null
          sent_at?: string
        }
        Relationships: []
      }
      deliverables: {
        Row: {
          id: string
          client_id: string | null
          project_id: string | null
          kind: Database['public']['Enums']['deliverable_kind']
          drive_file_id: string | null
          drive_folder_id: string | null
          file_name: string | null
          original_file_name: string | null
          file_hash: string | null
          source_url: string | null
          mime_type: string | null
          size_bytes: number | null
          source: Database['public']['Enums']['deliverable_source']
          status: Database['public']['Enums']['deliverable_status']
          match_confidence: number | null
          match_method: string | null
          match_candidates: Json
          duplicate_of: string | null
          gmail_message_id: string | null
          email_subject: string | null
          email_from: string | null
          email_date: string | null
          forwarded_by: string | null
          filed_by: string | null
          filed_at: string | null
          deleted_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id?: string | null
          project_id?: string | null
          kind: Database['public']['Enums']['deliverable_kind']
          drive_file_id?: string | null
          drive_folder_id?: string | null
          file_name?: string | null
          original_file_name?: string | null
          file_hash?: string | null
          source_url?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          source: Database['public']['Enums']['deliverable_source']
          status: Database['public']['Enums']['deliverable_status']
          match_confidence?: number | null
          match_method?: string | null
          match_candidates?: Json
          duplicate_of?: string | null
          gmail_message_id?: string | null
          email_subject?: string | null
          email_from?: string | null
          email_date?: string | null
          forwarded_by?: string | null
          filed_by?: string | null
          filed_at?: string | null
          deleted_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          client_id?: string | null
          project_id?: string | null
          kind?: Database['public']['Enums']['deliverable_kind']
          drive_file_id?: string | null
          drive_folder_id?: string | null
          file_name?: string | null
          original_file_name?: string | null
          file_hash?: string | null
          source_url?: string | null
          mime_type?: string | null
          size_bytes?: number | null
          source?: Database['public']['Enums']['deliverable_source']
          status?: Database['public']['Enums']['deliverable_status']
          match_confidence?: number | null
          match_method?: string | null
          match_candidates?: Json
          duplicate_of?: string | null
          gmail_message_id?: string | null
          email_subject?: string | null
          email_from?: string | null
          email_date?: string | null
          forwarded_by?: string | null
          filed_by?: string | null
          filed_at?: string | null
          deleted_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      oauth_clients: {
        Row: {
          id: string
          name: string
          redirect_uris: Json
          created_at: string
        }
        Insert: {
          id: string
          name?: string
          redirect_uris: Json
          created_at?: string
        }
        Update: {
          id?: string
          name?: string
          redirect_uris?: Json
          created_at?: string
        }
        Relationships: []
      }
      oauth_codes: {
        Row: {
          code_hash: string
          client_id: string
          user_id: string
          redirect_uri: string
          code_challenge: string
          scope: string
          expires_at: string
          consumed_at: string | null
        }
        Insert: {
          code_hash: string
          client_id: string
          user_id: string
          redirect_uri: string
          code_challenge: string
          scope: string
          expires_at: string
          consumed_at?: string | null
        }
        Update: {
          code_hash?: string
          client_id?: string
          user_id?: string
          redirect_uri?: string
          code_challenge?: string
          scope?: string
          expires_at?: string
          consumed_at?: string | null
        }
        Relationships: []
      }
      oauth_tokens: {
        Row: {
          id: string
          token_hash: string
          refresh_hash: string | null
          client_id: string
          user_id: string
          user_email: string
          scope: string
          expires_at: string
          refresh_expires_at: string
          rotated_at: string | null
          replaced_by: string | null
          grace_used: boolean
          revoked_at: string | null
          last_used_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          token_hash: string
          refresh_hash?: string | null
          client_id: string
          user_id: string
          user_email: string
          scope?: string
          expires_at: string
          refresh_expires_at: string
          rotated_at?: string | null
          replaced_by?: string | null
          grace_used?: boolean
          revoked_at?: string | null
          last_used_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          token_hash?: string
          refresh_hash?: string | null
          client_id?: string
          user_id?: string
          user_email?: string
          scope?: string
          expires_at?: string
          refresh_expires_at?: string
          rotated_at?: string | null
          replaced_by?: string | null
          grace_used?: boolean
          revoked_at?: string | null
          last_used_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          id: string
          user_id: string
          user_email: string
          text: string
          due_date: string
          project_id: string | null
          done: boolean
          done_at: string | null
          notified_at: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          user_email: string
          text: string
          due_date: string
          project_id?: string | null
          done?: boolean
          done_at?: string | null
          notified_at?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          user_email?: string
          text?: string
          due_date?: string
          project_id?: string | null
          done?: boolean
          done_at?: string | null
          notified_at?: string | null
          created_at?: string
        }
        Relationships: []
      }
      mcp_tool_calls: {
        Row: {
          id: string
          user_email: string
          tool: string
          duration_ms: number | null
          ok: boolean
          detail: Json | null
          project_id: string | null
          client_id: string | null
          error_code: string | null
          error_message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_email: string
          tool: string
          duration_ms?: number | null
          ok: boolean
          detail?: Json | null
          project_id?: string | null
          client_id?: string | null
          error_code?: string | null
          error_message?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          user_email?: string
          tool?: string
          duration_ms?: number | null
          ok?: boolean
          detail?: Json | null
          project_id?: string | null
          client_id?: string | null
          error_code?: string | null
          error_message?: string | null
          created_at?: string
        }
        Relationships: []
      }
      email_inbox: {
        Row: {
          id: string
          external_id: string
          status: Database['public']['Enums']['email_inbox_status']
          project_id: string | null
          client_id: string | null
          direction: string | null
          from_email: string | null
          to_emails: string[] | null
          subject: string | null
          snippet: string | null
          body: string | null
          occurred_at: string
          gmail_message_id: string | null
          source: string
          match_candidates: Json | null
          matched_confidence: number | null
          created_at: string
        }
        Insert: {
          id?: string
          external_id: string
          status?: Database['public']['Enums']['email_inbox_status']
          project_id?: string | null
          client_id?: string | null
          direction?: string | null
          from_email?: string | null
          to_emails?: string[] | null
          subject?: string | null
          snippet?: string | null
          body?: string | null
          occurred_at?: string
          gmail_message_id?: string | null
          source?: string
          match_candidates?: Json | null
          matched_confidence?: number | null
          created_at?: string
        }
        Update: {
          id?: string
          external_id?: string
          status?: Database['public']['Enums']['email_inbox_status']
          project_id?: string | null
          client_id?: string | null
          direction?: string | null
          from_email?: string | null
          to_emails?: string[] | null
          subject?: string | null
          snippet?: string | null
          body?: string | null
          occurred_at?: string
          gmail_message_id?: string | null
          source?: string
          match_candidates?: Json | null
          matched_confidence?: number | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'email_inbox_project_id_fkey'
            columns: ['project_id']
            isOneToOne: false
            referencedRelation: 'survey_projects'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'email_inbox_client_id_fkey'
            columns: ['client_id']
            isOneToOne: false
            referencedRelation: 'clients'
            referencedColumns: ['id']
          }
        ]
      }
      rerun_snapshot: {
        Row: {
          id: string
          sheet_row: number | null
          client: string | null
          next_cadence: string | null
          work: string | null
          freq: string | null
          platform: string | null
          cadence: string | null
          n: string | null
          template: string | null
          note: string | null
          status_raw: string | null
          survey_ids: string | null
          next_run_date: string | null
          status_class: string | null
          rerun_key: string | null
          synced_at: string
        }
        Insert: {
          id?: string
          sheet_row?: number | null
          client?: string | null
          next_cadence?: string | null
          work?: string | null
          freq?: string | null
          platform?: string | null
          cadence?: string | null
          n?: string | null
          template?: string | null
          note?: string | null
          status_raw?: string | null
          survey_ids?: string | null
          next_run_date?: string | null
          status_class?: string | null
          rerun_key?: string | null
          synced_at?: string
        }
        Update: {
          id?: string
          sheet_row?: number | null
          client?: string | null
          next_cadence?: string | null
          work?: string | null
          freq?: string | null
          platform?: string | null
          cadence?: string | null
          n?: string | null
          template?: string | null
          note?: string | null
          status_raw?: string | null
          survey_ids?: string | null
          next_run_date?: string | null
          status_class?: string | null
          rerun_key?: string | null
          synced_at?: string
        }
        Relationships: []
      }
      rerun_meta: {
        Row: {
          rerun_key: string
          display_name: string | null
          cadence_months: number | null
          last_wave_on: string | null
          expected_next_on: string | null
          owner_email: string | null
          backup_owner_email: string | null
          lead_days: number | null
          prep_nudged_for: string | null
          overdue_nudged_for: string | null
          paused: boolean
          note: string | null
          updated_by: string | null
          updated_at: string
        }
        Insert: {
          rerun_key: string
          display_name?: string | null
          cadence_months?: number | null
          last_wave_on?: string | null
          expected_next_on?: string | null
          owner_email?: string | null
          backup_owner_email?: string | null
          lead_days?: number | null
          prep_nudged_for?: string | null
          overdue_nudged_for?: string | null
          paused?: boolean
          note?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Update: {
          rerun_key?: string
          display_name?: string | null
          cadence_months?: number | null
          last_wave_on?: string | null
          expected_next_on?: string | null
          owner_email?: string | null
          backup_owner_email?: string | null
          lead_days?: number | null
          prep_nudged_for?: string | null
          overdue_nudged_for?: string | null
          paused?: boolean
          note?: string | null
          updated_by?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      rerun_review_log: {
        Row: {
          id: string
          reviewed_by: string | null
          overdue_count: number | null
          undefined_count: number | null
          due_soon_count: number | null
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          reviewed_by?: string | null
          overdue_count?: number | null
          undefined_count?: number | null
          due_soon_count?: number | null
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          reviewed_by?: string | null
          overdue_count?: number | null
          undefined_count?: number | null
          due_soon_count?: number | null
          note?: string | null
          created_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      rerun_status: {
        Row: {
          id: string
          sheet_row: number | null
          client: string | null
          next_cadence: string | null
          work: string | null
          freq: string | null
          platform: string | null
          cadence: string | null
          n: string | null
          template: string | null
          note: string | null
          status_raw: string | null
          survey_ids: string | null
          next_run_date: string | null
          status_class: string | null
          rerun_key: string | null
          synced_at: string
          display_name: string | null
          cadence_months: number | null
          last_wave_on: string | null
          expected_next_on: string | null
          owner_email: string | null
          backup_owner_email: string | null
          lead_days: number | null
          prep_nudged_for: string | null
          overdue_nudged_for: string | null
          is_paused: boolean | null
          is_defined: boolean | null
          has_cadence_due: boolean | null
          effective_due: string | null
          days_to_due: number | null
          is_overdue: boolean | null
          in_prep_window: boolean | null
          needs_definition: boolean | null
        }
        Relationships: []
      }
      portal_projects: {
        Row: {
          id: string
          project_name: string
          client_id: string
          submitted_date: string | null
          launch_date: string | null
          due_date: string | null
          created_at: string
        }
        Relationships: []
      }
    }
    Functions: {
      replace_rerun_snapshot: {
        Args: { rows: Json }
        Returns: number
      }
      merge_projects: {
        Args: { p_survivor: string; p_loser: string }
        Returns: undefined
      }
      merge_clients: {
        Args: { p_survivor: string; p_loser: string }
        Returns: undefined
      }
      mcp_write_project: {
        Args: {
          p_id: string
          p_patch: Json
          p_actor: string
          p_expected_updated_at?: string | null
        }
        Returns: unknown
      }
      mcp_create_project: {
        Args: { p_patch: Json; p_actor: string }
        Returns: unknown
      }
      mcp_add_step: {
        Args: { p_project: string; p_text: string; p_created_by: string; p_actor: string }
        Returns: unknown
      }
      mcp_complete_step: {
        Args: { p_step: string; p_done: boolean; p_by: string; p_actor: string }
        Returns: unknown
      }
      mcp_edit_step: {
        Args: { p_step: string; p_text: string; p_actor: string }
        Returns: unknown
      }
      mcp_set_bid_budget: {
        Args: {
          p_project: string
          p_amount: number
          p_note: string
          p_created_by: string
          p_idem: string
          p_actor: string
        }
        Returns: unknown
      }
      mcp_log_blast: {
        Args: {
          p_project: string
          p_delivered: number
          p_bid: number
          p_blast_cost: number
          p_note: string
          p_created_by: string
          p_idem: string
          p_actor: string
        }
        Returns: unknown
      }
      mcp_rename_client: {
        Args: { p_id: string; p_new_name: string; p_actor: string }
        Returns: undefined
      }
    }
    Enums: {
      profile_role: 'analyst' | 'compliance'
      submission_status: 'pending_review' | 'approved' | 'rejected'
      question_type: 'open_text' | 'single_select' | 'multi_select' | 'scale' | 'other'
      recipient_role: 'alpharoc' | 'compliance'
      project_type: 'PS' | 'B2B' | 'Rerun' | 'Internal'
      project_status: 'Open' | 'Closed' | 'Hold'
      project_phase: 'Scoping' | 'Active'
      board_column:
        | 'Submitted'
        | 'Doc Programming'
        | 'Survey Programming'
        | 'EdWin QA'
        | 'Fielding'
        | 'Data QA'
        | 'Delivery'
        | 'Backlog'
        | 'In Progress'
        | 'Review'
        | 'Done'
      scoping_stage:
        | 'New Inquiry'
        | 'Proposal Sent'
        | 'Pricing Discussion'
        | 'Awaiting Approval'
        | 'Closed'
      deliverable_source: 'email' | 'upload'
      deliverable_kind: 'file' | 'link'
      deliverable_status: 'filed' | 'review' | 'duplicate' | 'unsorted'
      email_inbox_status: 'review' | 'pending_no_project' | 'filed' | 'ignored'
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
export type EmailInbox = Tables<'email_inbox'>
export type EmailInboxStatus = Enums<'email_inbox_status'>

// Enum types
export type ProjectType = Enums<'project_type'>
export type ProjectStatus = Enums<'project_status'>
export type ProjectPhase = Enums<'project_phase'>
export type BoardColumn = Enums<'board_column'>
export type ScopingStage = Enums<'scoping_stage'>
