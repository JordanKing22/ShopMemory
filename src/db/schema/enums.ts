/** Enumerations shared by the schema, the seed loader and the app. Declared once (PLAN.md §5.1). */

export const CLASSIFICATIONS = ["general", "internal", "customer_confidential", "export_controlled"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const CLASS_RANK: Record<Classification, number> = {
  general: 0,
  internal: 1,
  customer_confidential: 2,
  export_controlled: 3,
};
export function maxClass(...cs: Classification[]): Classification {
  return cs.reduce<Classification>((a, b) => (CLASS_RANK[b] > CLASS_RANK[a] ? b : a), "general");
}
export const CLASSIFICATION_SOURCES = ["derived", "override_up", "override_down"] as const;

export const ROLES = ["owner", "quoter", "machinist", "trainee"] as const;
export type Role = (typeof ROLES)[number];

export const DEPARTMENTS = ["quoting", "machining", "quality", "programming", "management"] as const;
export const COHORTS = ["veteran", "new_hire"] as const;
export const DEPARTURE_KINDS = ["retirement", "other"] as const;

export const MACHINE_KINDS = ["vmc", "lathe", "five_axis", "mill_turn", "swiss", "cmm", "wire_edm"] as const;
export const MACHINE_STATUSES = ["running", "down", "pm"] as const;
export const MACHINE_EVENT_KINDS = ["issue", "repair", "pm", "crash", "alarm", "upgrade"] as const;

export const MATERIAL_FAMILIES = ["aluminum", "stainless", "titanium", "nickel_alloy", "plastic"] as const;
export const INDUSTRIES = ["aerospace", "medical", "semiconductor", "defense"] as const;

export const PART_FAMILIES = [
  "bracket",
  "housing",
  "manifold",
  "fitting",
  "shaft",
  "sleeve",
  "ring",
  "plate",
  "insulator",
  "instrument",
  "fixture",
] as const;
export type PartFamily = (typeof PART_FAMILIES)[number];

export const PART_FEATURES = [
  "thin_wall",
  "five_axis",
  "tight_tolerance",
  "deep_pocket",
  "thread_milling",
  "edm_detail",
  "first_article",
  "heat_treat",
  "passivation",
  "anodize",
  "cleanroom",
  "long_slender",
] as const;
export type PartFeature = (typeof PART_FEATURES)[number];

export const EXPORT_CONTROL = ["none", "ear99", "ear_controlled", "itar"] as const;
export const JUDGMENT_DRIVERS = [
  "thin_wall",
  "titanium",
  "inconel",
  "five_axis",
  "tight_tolerance",
  "new_customer",
  "first_article",
] as const;
export type JudgmentDriver = (typeof JUDGMENT_DRIVERS)[number];

export const QUOTE_OUTCOMES = ["won", "lost", "no_bid", "pending"] as const;
export const LOST_REASONS = ["price", "lead_time", "capability", "unknown"] as const;
export const JOB_STATUSES = ["scheduled", "in_process", "complete"] as const;
export const RISK_BUCKETS = ["hours", "setup", "scrap_allowance", "inspection", "outside_processing", "other"] as const;

export const TOPIC_CATEGORIES = ["process", "machine", "material", "customer"] as const;
export const ASSESSED_BY = ["sme_seed", "owner", "self"] as const;

export const CARD_TYPES = [
  "quoting_rule",
  "setup_tip",
  "machine_quirk",
  "customer_quirk",
  "inspection_gotcha",
  "failure_story",
] as const;
export type CardType = (typeof CARD_TYPES)[number];
export const CARD_STATUSES = ["draft", "pending_review", "approved", "rejected", "superseded"] as const;
export type CardStatus = (typeof CARD_STATUSES)[number];
export const CONFIDENCE = ["always", "usually", "sometimes", "not_sure", "not_stated"] as const;
export type Confidence = (typeof CONFIDENCE)[number];
export const CARD_SOURCE_KINDS = ["interview", "quote_log", "manual", "seed_binder"] as const;
export const CARD_CREATED_BY = ["seed", "ai_extracted", "manual"] as const;
export const APPROVAL_MODES = ["self", "on_behalf"] as const;
export const LINK_KINDS = ["job", "quote", "part", "machine", "material", "customer", "person"] as const;
export type LinkKind = (typeof LINK_KINDS)[number];
export const LINK_BASIS = ["session_context", "mentioned_candidate", "seed"] as const;
export const COMPARATORS = ["<", "<=", "=", ">=", ">", "between", "approx"] as const;

export const INTERVIEW_MODES = ["full_interview", "quote_reasoning_log", "manual_entry"] as const;
export const INTERVIEW_PLANS = ["generic", "quote_anchor"] as const;
export const INTERVIEW_STATUSES = [
  "consent_pending",
  "in_progress",
  "extracting",
  "review",
  "complete",
  "abandoned",
] as const;
export const SPEECH_ENGINES = ["typed", "on_device", "browser_cloud", "local_stt", "simulated"] as const;
export const SPEAKERS = ["interviewer", "expert", "system"] as const;
export const TEXT_SOURCES = ["typed", "voice", "simulated", "template", "llm", "seed"] as const;
export const MOVES = [
  "ANCHOR",
  "SCOPE",
  "TASK_MAP",
  "INCIDENT",
  "TIMELINE",
  "DEEPEN",
  "WHAT_IF",
  "NOVICE_GAP",
  "TEACH_BACK",
  "WRAP",
  "CLARIFY_NUMBER",
  "ASK_WHY",
  "ASK_CONDITION",
  "ASK_EXCEPTION",
  "ASK_HOW_TELL",
  "SURFACE_CONFLICT",
  "PROBE_MARKER",
  "KA_PROBE",
] as const;
export const AI_MODES = ["cloud", "local", "hybrid"] as const;
export const TARGET_CLASSES = ["anthropic", "bedrock_commercial", "bedrock_govcloud", "ollama_local"] as const;

export const DOC_KINDS = ["setup_sheet", "work_instruction", "onboarding_checklist"] as const;
export const DOC_STATUSES = ["draft", "expert_review", "approved", "superseded"] as const;
export const DOC_GENERATED_BY = ["seed", "ai", "manual", "assembled"] as const;
export const DOC_SECTIONS = ["header", "workholding", "tools", "operations", "inspection", "cautions", "checklist"] as const;

export const QUIZ_STATUSES = ["draft", "approved"] as const;
export const QUIZ_ITEM_TYPES = ["apply", "boundary", "spot_cue", "novice_trap", "rank"] as const;
export const QUIZ_GENERATED_BY = ["seed", "ai", "assembled"] as const;
export const ATTEMPT_STATUSES = ["in_progress", "graded"] as const;
export const GRADES = ["correct", "partial", "incorrect", "unclear"] as const;
export const GRADED_BY = ["code", "llm", "seed"] as const;

export const CAPTURE_KINDS = ["voice", "note", "photo"] as const;
export const CAPTURE_STATUSES = ["pending_review", "approved", "rejected"] as const;
export const ASK_ROLES = ["user", "assistant"] as const;

export const PROVIDER_KINDS = ["anthropic", "bedrock", "ollama"] as const;
export const AUDIT_DECISIONS = ["allow", "withheld_partial", "blocked", "held", "user_excluded_controlled"] as const;
export const AUDIT_TRANSPORTS = ["live", "demo_replay_exact", "demo_replay_scenario", "demo_fallback", "none"] as const;
export const AUDIT_OUTCOMES = [
  "pending",
  "ok",
  "refusal",
  "invalid_output",
  "provider_error",
  "blocked",
  "held",
  "aborted",
  "timeout",
] as const;
export const PAYLOAD_STORED_FORMS = ["as_sent_redacted", "redacted_for_storage"] as const;
export const CASSETTE_PROVENANCE = ["recorded", "hand_authored"] as const;
export const EVENT_KINDS = [
  "consent",
  "consent_withdrawn",
  "persona_switch",
  "settings_change",
  "card_transition",
  "document_transition",
  "capture_transition",
  "quiz_transition",
  "classification_change",
  "speech_session",
  "speech_blocked",
  "possible_controlled_content_sent",
  "audit_export",
  "full_export",
  "full_delete",
  "demo_reset",
  "demo_fast_forward",
  "health_check",
] as const;
export const TOKEN_KINDS = [
  "CUSTOMER",
  "PERSON",
  "PART",
  "JOB",
  "QUOTE",
  "CONTACT",
  "PN",
  "EMAIL",
  "PHONE",
  "AMOUNT",
] as const;
export const SNAPSHOT_REASONS = ["seed_baseline", "cards_approved", "manual"] as const;
export const SNAPSHOT_SCOPES = ["cell", "topic", "person"] as const;
