/** Shapes of the Logs API responses the pages use (fields as the API names them). */

export type Page<T> = { items: T[]; next_cursor: string | null };

export type ConversationSummary = {
  conversation: string;
  title: string | null;
  first_seen_at: string;
  last_seen_at: string;
  turns: number;
  failures: number;
  endpoint: string | null;
  robot_serial: string | null;
  robot_name: string | null;
  prompt_id: string | null;
  first_input: string | null;
  org: string | null;
  project: string | null;
  agent: string | null;
  match_turn_id: string | null;
  match_snippet: string | null;
};

export type Attachment = { sha256: string; filename: string | null; media_type: string | null };

export type Recording = {
  id: string;
  created_at: string;
  status: string;
  transcript_final: string | null;
  audio_sha256: string | null;
};

export type Turn = {
  id: string;
  started_at: string;
  ended_at: string | null;
  latency_ms: number | null;
  endpoint: string;
  robot_serial: string | null;
  robot_name: string | null;
  prompt_id: string | null;
  status: "ok" | "failed" | "no_response";
  http_status: number | null;
  error_text: string | null;
  input_text: string | null;
  output_text: string | null;
  input_chars: number | null;
  output_chars: number | null;
  media: Record<string, unknown> | null;
  conversation: string | null;
  conversation_title: string | null;
  conversation_seq: number | null;
  conversation_turns: number | null;
  tags: string[];
  control_labels: string[];
  attachments: Attachment[];
  org: string | null;
  project: string | null;
  agent: string | null;
};

export type TurnDetail = Turn & {
  request_id: string | null;
  labels: unknown;
  recordings: Recording[];
};

export type ConversationTurnPage = Page<Turn> & { prev_cursor: string | null };

export type Note = { id: number; text: string; created_at: string };
export type Tag = { id: number; name: string };
export type Curation = { bookmarked: boolean; notes: Note[]; tags: Tag[] };
export type TitleEdit = { version: number; title: string; previous: string; editor: string | null; editor_is_guest: boolean; edited_at: string };
export type TitleOut = { title: string; version: number; last_edit: TitleEdit | null };
export type TitleConflict = { detail: string; current: TitleOut };

export type SpeechEvent = {
  id: string;
  kind: string;
  created_at: string;
  latency_ms: number | null;
  status: string;
  http_status: number | null;
  error_text: string | null;
  stt_audio_id: string | null;
  transcript_final: string | null;
  audio_sha256: string | null;
  text_in: string | null;
  char_count: number | null;
  audio_out_bytes: number | null;
  turn_id: string | null;
  endpoint: string | null;
  robot_serial: string | null;
  robot_name: string | null;
  prompt_id: string | null;
  org: string | null;
  project: string | null;
  agent: string | null;
};

export type ExportJob = {
  id: string;
  format: string;
  status: string;
  rows: number;
  truncated: boolean;
  byte_size: number | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
  expires_at: string | null;
  file_available: boolean;
  filter: Record<string, unknown>;
  include_notes: boolean;
  language: string;
  name_from_title: boolean;
  name: string;
  file_name: string;
};
