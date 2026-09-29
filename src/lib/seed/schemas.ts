/**
 * Zod schemas for every file in seed-data/ (the formats a machining SME edits).
 * Field names are snake_case in the files; the loader maps them to DB rows.
 */
import { z } from "zod";
import {
  APPROVAL_MODES,
  CARD_STATUSES,
  CARD_TYPES,
  CLASSIFICATIONS,
  COHORTS,
  COMPARATORS,
  CONFIDENCE,
  DEPARTMENTS,
  DEPARTURE_KINDS,
  DOC_KINDS,
  DOC_STATUSES,
  EXPORT_CONTROL,
  INDUSTRIES,
  INTERVIEW_MODES,
  INTERVIEW_PLANS,
  JOB_STATUSES,
  LINK_KINDS,
  LOST_REASONS,
  MACHINE_EVENT_KINDS,
  MACHINE_KINDS,
  MATERIAL_FAMILIES,
  PART_FAMILIES,
  PART_FEATURES,
  QUOTE_OUTCOMES,
  RISK_BUCKETS,
  ROLES,
  SPEECH_ENGINES,
  TOPIC_CATEGORIES,
} from "@/db/schema/enums";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");
const isoTs = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/, "use an ISO timestamp like 2026-06-18T14:00:00Z");
const classification = z.enum(CLASSIFICATIONS);
/** A search term or alias; bare YAML numbers like 718 or 6061 are accepted and kept as text. */
const term = z.union([z.string().min(1), z.number()]).transform((v) => String(v));
const id = (prefix: RegExp, hint: string) => z.string().regex(prefix, `ID must look like ${hint}`);

export const PersonId = id(/^PER-\d{2}$/, "PER-01");
export const PersonaId = id(/^P-(OWNER|PER-\d{2})$/, "P-OWNER or P-PER-01");
export const CustomerId = id(/^CUS-\d{2}$/, "CUS-01");
export const MachineId = id(/^m-[a-z0-9-]+$/, "m-dmu50");
export const MaterialId = id(/^mat-[a-z0-9-]+$/, "mat-ti64");
export const PartId = id(/^PRT-[AGI]\d{2}$/, "PRT-A01");
export const QuoteId = id(/^Q-(A\d{2}|G\d{3})$/, "Q-A01 or Q-G001");
export const JobId = id(/^J-(A\d{2}|G\d{3}|I\d{2})$/, "J-A02, J-G004 or J-I01");
export const TopicId = id(/^t-[a-z0-9-]+$/, "t-thin-wall");
export const CardId = id(/^KC-\d{3}$/, "KC-001");
export const InterviewId = id(/^INT-(\d{2}|LIVE-RAY|M-PER-\d{2}|\d{3})$/, "INT-01");
export const TurnId = id(/^INT-[A-Z0-9-]+-T\d{3}$/, "INT-01-T014");
export const DocId = id(/^DOC-(SS-\d{2}|SS-LIVE|\d{3})$/, "DOC-SS-01");

export const ShopFile = z.object({
  name: z.string().min(1),
  employee_count: z.number().int().positive(),
  certifications: z.array(z.string()),
  demo_today: date,
  seed: z.number().int(),
  fictional_notice: z.string().min(1),
});

export const PeopleFile = z.array(
  z.object({
    id: PersonId,
    full_name: z.string().min(1),
    display_name: z.string().min(1),
    job_title: z.string().min(1),
    department: z.enum(DEPARTMENTS),
    app_role: z.enum(ROLES),
    cohort: z.enum(COHORTS),
    hire_date: date,
    prior_experience_years: z.number().min(0).default(0),
    planned_departure_date: date.nullable().default(null),
    departure_kind: z.enum(DEPARTURE_KINDS).nullable().default(null),
    bio: z.string().default(""),
    aliases: z.array(term).min(1),
  }),
);

export const PersonasFile = z.array(
  z.object({
    id: PersonaId,
    label: z.string().min(1),
    role: z.enum(ROLES),
    person: PersonId.nullable().default(null),
    aliases: z.array(term).default([]),
    default_for_role: z.boolean().default(false),
    show_in_switcher: z.boolean().default(true),
  }),
);

export const MachineEventSeed = z.object({
  id: id(/^ME-\d{3}$/, "ME-001"),
  on: date,
  kind: z.enum(MACHINE_EVENT_KINDS),
  summary: z.string().min(1),
  job: JobId.nullable().default(null),
  person: PersonId.nullable().default(null),
  classification: classification.optional(),
});

export const MachinesFile = z.array(
  z.object({
    id: MachineId,
    asset_tag: z.string().min(1),
    name: z.string().min(1),
    make: z.string().min(1),
    model: z.string().min(1),
    kind: z.enum(MACHINE_KINDS),
    year_installed: z.number().int(),
    acquired: z.enum(["new", "used"]),
    location_cell: z.string().nullable().default(null),
    status: z.enum(["running", "down", "pm"]).default("running"),
    capabilities: z.array(z.string()).default([]),
    unit_history: z.string().default(""),
    events: z.array(MachineEventSeed).default([]),
  }),
);

export const MaterialsFile = z.array(
  z.object({
    id: MaterialId,
    name: z.string().min(1),
    short_name: z.string().min(1),
    family: z.enum(MATERIAL_FAMILIES),
    aliases: z.array(term).default([]),
    notes: z.string().default(""),
  }),
);

export const CustomersFile = z.array(
  z.object({
    id: CustomerId,
    name: z.string().min(1),
    industry: z.enum(INDUSTRIES),
    segment: z.string().default(""),
    customer_since: date,
    is_new_customer: z.boolean(),
    part_classification_floor: classification,
    classification: classification.default("customer_confidential"),
    quality_requirements: z.string().default(""),
    aliases: z.array(term).default([]),
    part_number_pattern: z.string().min(1), // regex source, e.g. ^AV-\d{4}-\d{2}$
    account: z.object({
      contact_name: z.string(),
      contact_email: z.string().regex(/@([a-z0-9-]+\.)*example\.com$/, "contact emails must end in example.com"),
      payment_terms: z.string(),
      annual_spend_usd: z.number().int(),
      pricing_notes: z.string().default(""),
    }),
  }),
);

export const NamesFile = z.array(
  z.object({
    name: z.string().min(1),
    kind: z.enum(["product", "shop", "customer", "person", "part_number_prefix"]),
    checked_on: date,
    result: z.enum(["no_collision_found", "low", "medium", "high"]),
    note: z.string().default(""),
    source: z.enum(["brief", "plan"]).default("plan"),
  }),
);

export const TopicsFile = z.array(
  z.object({
    id: TopicId,
    category: z.enum(TOPIC_CATEGORIES),
    label: z.string().min(1),
    description: z.string().default(""),
    machine: MachineId.nullable().default(null),
    material: MaterialId.nullable().default(null),
    customer: CustomerId.nullable().default(null),
  }),
);

export const TagsFile = z.array(
  z.object({
    id: z.string().regex(/^[a-z0-9-]+$/, "tag IDs are lowercase-with-dashes"),
    label: z.string().min(1),
    topic: TopicId.nullable().default(null),
    synonyms: z.array(term).default([]),
  }),
);

export const SynonymsFile = z.array(z.array(term).min(2)); // groups of equivalent terms

export const PartSeed = z.object({
  id: PartId,
  customer: CustomerId.nullable(),
  part_number: z.string().min(1),
  revision: z.string().min(1),
  description: z.string().min(1),
  family: z.enum(PART_FAMILIES),
  material: MaterialId,
  features: z.array(z.enum(PART_FEATURES)).default([]),
  min_wall_in: z.number().nullable().default(null),
  max_wall_height_in: z.number().nullable().default(null),
  tightest_tol_in: z.number().nullable().default(null),
  envelope_in: z.string().nullable().default(null),
  complexity: z.number().int().min(1).max(5),
  export_control: z.enum(EXPORT_CONTROL).default("none"),
  notes: z.string().default(""),
  classification: classification.optional(),
  classification_override: z
    .object({ direction: z.enum(["up", "down"]), reason: z.string().min(1) })
    .optional(),
});
export const PartsFile = z.array(PartSeed);

export const JobSeed = z.object({
  id: JobId,
  job_number: z.string().regex(/^RJ-\d{2}-\d{4}$/, "job numbers look like RJ-26-0310"),
  status: z.enum(JOB_STATUSES),
  started_on: date.nullable().default(null),
  shipped_on: date.nullable().default(null),
  lead: PersonId.nullable().default(null),
  actual_machine: MachineId.nullable().default(null),
  actual_setup_hours: z.number().nullable().default(null),
  actual_run_hours: z.number().nullable().default(null),
  actual_hours: z.number().nullable().default(null),
  scrap_qty: z.number().int().default(0),
  ncr_count: z.number().int().default(0),
  on_time: z.boolean().nullable().default(null),
  debrief: z.string().default(""),
});

export const QuoteSeed = z.object({
  id: QuoteId,
  quote_number: z.string().regex(/^RQ-\d{2}-\d{4}$/, "quote numbers look like RQ-26-0911"),
  part: PartId,
  quoted_on: date,
  quoted_by: PersonId,
  qty: z.number().int().positive(),
  primary_machine: MachineId,
  secondary_machine: MachineId.nullable().default(null),
  quoted_setup_hours: z.number().nonnegative(),
  quoted_cycle_minutes: z.number().nonnegative(),
  quoted_hours: z.number().positive(),
  lead_time_days: z.number().int().nullable().default(null),
  outcome: z.enum(QUOTE_OUTCOMES),
  lost_reason: z.enum(LOST_REASONS).nullable().default(null),
  notes: z.string().default(""),
  financials: z.object({
    shop_rate_usd_per_hr: z.number(),
    material_cost_usd: z.number(),
    outside_processing_usd: z.number().default(0),
    risk_adder_hours: z.number().default(0),
    scrap_allowance_pct: z.number().default(0),
    unit_price_usd: z.number(),
    total_price_usd: z.number(),
    target_margin_pct: z.number(),
  }),
  job: JobSeed.nullable().default(null),
});
export const QuotesFile = z.array(QuoteSeed);

export const InternalWorkOrdersFile = z.array(JobSeed.extend({ part: PartId }));

/** Generator templates (parts/families.yaml): per customer, a list of part families to generate. */
export const FamiliesFile = z.array(
  z.object({
    customer: CustomerId,
    part_number_format: z.string().min(1), // e.g. "AV-{4}-{2}" where {n} = n random digits
    quotes: z.number().int().positive().optional(), // total quotes for this customer, anchors included
    families: z.array(
      z.object({
        family: z.enum(PART_FAMILIES),
        count: z.number().int().positive(),
        descriptions: z.array(z.string().min(1)).min(1),
        materials: z.array(MaterialId).min(1),
        features: z.array(z.array(z.enum(PART_FEATURES))).min(1), // candidate feature sets
        complexity: z.array(z.number().int().min(1).max(5)).min(1),
        export_control: z.enum(EXPORT_CONTROL).default("none"),
        machines: z.array(MachineId).min(1),
      }),
    ),
  }),
);

const Dist = z.object({ mean: z.number(), sd: z.number().nonnegative() });
export const QuoteModelFile = z.object({
  setup_hours_by_machine_kind: z.record(z.string(), z.number()),
  cycle_minutes_by_family: z.record(z.string(), z.number()),
  material_time_factor: z.record(z.string(), z.number()),
  complexity_factor: z.record(z.string(), z.number()),
  qty: z.object({ min: z.number().int(), max: z.number().int() }),
  shop_rate_usd_per_hr: z.record(z.string(), z.number()),
  material_cost_per_part_usd: z.record(z.string(), z.number()),
  target_margin_pct: z.number(),
  variance: z.object({
    base: Dist,
    drivers: z.record(z.string(), Dist),
    quoted_by_ray: z.object({ mean_multiplier: z.number(), sd_multiplier: z.number() }),
    clamp: z.tuple([z.number(), z.number()]),
  }),
  quoters: z.record(z.string(), z.number()), // weights by person id
  job_leads_by_machine_kind: z.record(z.string(), PersonId).default({}), // who leads a generated job on each machine kind
  quoters_turned_only: z.array(PersonId).default([]), // these quoters only quote turned parts
  turned_families: z.array(z.enum(PART_FAMILIES)).default([]),
  turned_machine_kinds: z.array(z.enum(MACHINE_KINDS)).default([]),
  ray_leave: z.tuple([date, date]),
  win_odds: z.object({
    base: z.number(),
    repeat_part: z.number(),
    new_customer: z.number(),
    ray_judgment_job: z.number(),
  }),
  quote_window_days: z.number().int().positive(),
  generated_quotes_per_part: z.array(z.number().int().positive()).min(1),
  debriefs: z.record(z.string(), z.array(z.string())), // by driver or "routine"
  reserved_combinations: z.array(
    z.object({ customer: CustomerId, material: MaterialId, family: z.enum(PART_FAMILIES), feature: z.enum(PART_FEATURES) }),
  ),
});

export const ThresholdSeed = z.object({
  quantity: z.string().min(1),
  comparator: z.enum(COMPARATORS),
  value: z.number().nullable(),
  value_max: z.number().nullable().default(null),
  unit: z.string().nullable(),
  verbatim: z.string().min(1),
});

export const CardLinksSeed = z
  .object({
    customer: CustomerId.optional(),
    customers: z.array(CustomerId).default([]),
    material: MaterialId.optional(),
    materials: z.array(MaterialId).default([]),
    machine: MachineId.optional(),
    machines: z.array(MachineId).default([]),
    jobs: z.array(JobId).default([]),
    quotes: z.array(QuoteId).default([]),
    parts: z.array(PartId).default([]),
    people: z.array(PersonId).default([]),
  })
  .default({ customers: [], materials: [], machines: [], jobs: [], quotes: [], parts: [], people: [] });

export const CardSeed = z.object({
  id: CardId,
  type: z.enum(CARD_TYPES),
  status: z.enum(CARD_STATUSES),
  title: z.string().min(1).max(90, "titles are at most 90 characters"),
  statement: z.string().min(1),
  applies_when: z.array(z.string()).default([]),
  does_not_apply_when: z.array(z.string()).default([]),
  rationale: z.string().nullable().default(null),
  cues: z.array(z.string()).default([]),
  actions: z.array(z.string()).default([]),
  common_mistake: z.string().nullable().default(null),
  thresholds: z.array(ThresholdSeed).default([]),
  expert_confidence: z.enum(CONFIDENCE),
  topics: z.array(TopicId).min(1).max(3, "at most 3 topics per card"),
  tags: z.array(z.string()).default([]),
  links: CardLinksSeed,
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("interview"), interview: InterviewId }),
    z.object({
      kind: z.enum(["seed_binder", "manual", "quote_log"]),
      // The expert's own words as originally entered; becomes a synthetic manual-entry turn (provenance).
      text: z.string().min(1),
      note: z.string().default(""),
    }),
  ]),
  evidence: z
    .array(z.object({ turn: TurnId, quote: z.string().min(1), confidence: z.boolean().default(false) }))
    .default([]),
  classification: classification.optional(),
  approved: z
    .object({ by: PersonId, on: date, mode: z.enum(APPROVAL_MODES).default("self") })
    .nullable()
    .default(null),
  review_notes: z.string().nullable().default(null),
  open_questions: z.array(z.string()).default([]),
  created_on: date,
});
export const CardsFile = z.array(CardSeed);

export const InterviewFrontmatter = z.object({
  id: InterviewId,
  title: z.string().min(1),
  mode: z.enum(INTERVIEW_MODES),
  plan: z.enum(INTERVIEW_PLANS).default("generic"),
  expert: PersonId,
  run_by: PersonaId.nullable().default(null),
  topic: TopicId.nullable().default(null),
  context: z
    .object({
      quote: QuoteId.nullable().default(null),
      job: JobId.nullable().default(null),
      part: PartId.nullable().default(null),
      customer: CustomerId.nullable().default(null),
    })
    .default({ quote: null, job: null, part: null, customer: null }),
  classification: classification.optional(),
  started_at: isoTs,
  ended_at: isoTs.nullable().default(null),
  speech_engine: z.enum(SPEECH_ENGINES).default("typed"),
  consent: z.object({ version: z.string().min(1), granted_at: isoTs }),
  summary: z.string().default(""),
});

export const QuoteLogsFile = z.array(
  z.object({
    id: id(/^QRL-\d{2}$/, "QRL-01"),
    quote: QuoteId,
    person: PersonId,
    main_driver: z.string(),
    machine_rationale: z.string(),
    hours_rationale: z.string(),
    risk_priced_in: z.string(),
    risk_bucket: z.enum(RISK_BUCKETS),
    what_would_change: z.string(),
    junior_would_miss: z.string(),
    confidence_1to5: z.number().int().min(1).max(5),
    variance_review: z.string().default(""),
    created_at: isoTs,
  }),
);

export const SetupSheetFrontmatter = z.object({
  id: DocId,
  kind: z.enum(DOC_KINDS).default("setup_sheet"),
  title: z.string().min(1),
  machine: MachineId,
  part: PartId.nullable().default(null),
  job: JobId.nullable().default(null),
  status: z.enum(DOC_STATUSES),
  reviewer: PersonId,
  approved_by: PersonId.nullable().default(null),
  approved_on: date.nullable().default(null),
  classification: classification.optional(),
  source_cards: z.array(CardId).min(1),
  program_refs: z.array(z.string()).default([]),
  created_on: date,
});

/** seed-data/demo/ray-live-interview.yaml — Ray's scripted answers and the pinned expected cards. */
export const RayLiveFile = z.object({
  interview: z.object({
    id: z.literal("INT-LIVE-RAY"),
    title: z.string(),
    topic: TopicId,
    context_quote: QuoteId,
    script_key: z.literal("demo:ray-live"),
    // Records the candidate-records step resolves from Ray's words (the pinned mention → record).
    candidates: z
      .array(z.object({ kind: z.enum(LINK_KINDS), id: z.string().min(1), mention: z.string().min(1) }))
      .default([]),
  }),
  turns: z.array(
    z.object({
      key: z.string(), // T0, R1, F1, …
      speaker: z.enum(["interviewer", "expert"]),
      move: z.string().nullable().default(null),
      source: z.enum(["template", "llm", "simulated"]),
      text: z.string().min(1),
    }),
  ),
  expected_cards: z.array(
    CardSeed.extend({
      evidence: z.array(z.object({ turn_key: z.string(), quote: z.string().min(1), confidence: z.boolean().default(false) })).min(1),
      link_basis: z.record(z.string(), z.enum(["session_context", "mentioned_candidate"])).default({}),
    }).omit({ source: true }),
  ),
});

/** seed-data/demo/anchors.yaml — demo-critical IDs and the invariants seed:check enforces. */
export const AnchorsFile = z.object({
  required_ids: z.record(z.string(), z.array(z.string())),
  similar_jobs: z.object({
    query: z.string(),
    expected_top3: z.array(JobId).length(3),
    expected_rank4: JobId,
  }),
  golden: z.object({
    before: z.record(z.string(), z.number()),
    after: z.record(z.string(), z.number()),
    spof: z.array(z.string()),
  }),
  // Values the demo script and cassettes depend on, as "RECORD-ID.field": value (seed-file field names).
  pinned: z.record(z.string().regex(/^[A-Za-z0-9-]+\.[a-z_]+$/, 'keys look like "Q-A01.quoted_hours"'), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
});
