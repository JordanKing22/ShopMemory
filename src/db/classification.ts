/**
 * Classification floors (PLAN.md §4.3). The one module that computes them.
 *
 *   Floor = max(linked records, source session, entities detected in the record's own text)
 *
 * | Record            | Floor                                                                      | Default                  |
 * |-------------------|----------------------------------------------------------------------------|--------------------------|
 * | part              | max(customer's part floor, export_control ∈ {ear_controlled, itar} → EC)   | = floor                  |
 * | quote / job       | the part (a job: its quote, or its part for internal work orders)          | = floor                  |
 * | interview         | max(linked quote/job/part/customer, level chosen at consent, content)      | = floor, ≥ internal      |
 * | knowledge card    | max(source interview, customer/part/job/quote links, content)              | max(floor, internal)     |
 * | document / quiz   | max of source cards (at pinned versions)                                   | = floor                  |
 * | photo / capture   | max(linked records); no job linked → jobs in process on that machine (30 d)| = floor, ≥ internal      |
 *
 * - Machine, material and person links (and person mentions) are reference entities: they never raise a floor.
 * - `general` is allowed only when the floor is `general`; declaring a level below the floor needs an owner
 *   override (direction down) with a reason. The owner-role check itself belongs to the caller.
 * - Recomputation only raises ({@link recomputeOnlyRaises}); a lowered source flags dependents
 *   "may be over-classified: review" instead of lowering them.
 * - Records whose classification was overridden down keep that level until the floor they were overridden
 *   against changes; callers should not feed them back through {@link recomputeOnlyRaises} blindly.
 * - Hidden manual-entry sessions take each turn's classification from its card; that mapping is the caller's.
 *
 * Pure functions, no DB access: called by the seed loader today and by the app's data layer later. Pass
 * classifications of already-resolved records (effective levels, after their own overrides).
 */
import { CLASS_RANK, maxClass, type Classification, type EXPORT_CONTROL } from "@/db/schema/enums";

/** `parts.export_control` values. */
export type ExportControl = (typeof EXPORT_CONTROL)[number];

/**
 * A classification input: a bare level, or anything carrying a `kind` and a `classification` — a card link
 * (`{ kind: "machine", … }`) or an `EntityMention` from `src/lib/policy/entity-detect.ts`. Items whose kind is
 * a {@link REFERENCE_KINDS reference kind} are ignored, so detector output can be passed through unfiltered.
 */
export type ClassInput = Classification | { readonly kind: string; readonly classification: Classification };

/** Link / mention kinds that never raise a floor (people, machines and materials are reference entities). */
export const REFERENCE_KINDS: ReadonlySet<string> = new Set(["machine", "material", "person"]);

/** Where a stored classification came from (`classification_source`). */
export type ClassificationSource = "derived" | "override_up" | "override_down";

/** An explicit change of level with its required reason. */
export interface ClassificationOverride {
  direction: "up" | "down";
  reason: string;
}

// ---------------------------------------------------------------------------------------------------------
// Comparisons
// ---------------------------------------------------------------------------------------------------------

/** a < b in the ranking general < internal < customer_confidential < export_controlled. */
export function classBelow(a: Classification, b: Classification): boolean {
  return CLASS_RANK[a] < CLASS_RANK[b];
}

/** a ≥ b. */
export function classAtLeast(a: Classification, b: Classification): boolean {
  return CLASS_RANK[a] >= CLASS_RANK[b];
}

/** The levels of the inputs that can raise a floor (reference kinds dropped). */
export function raisingClasses(inputs: readonly ClassInput[] = []): Classification[] {
  const out: Classification[] = [];
  for (const i of inputs) {
    if (typeof i === "string") out.push(i);
    else if (!REFERENCE_KINDS.has(i.kind)) out.push(i.classification);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------
// Floors
// ---------------------------------------------------------------------------------------------------------

/**
 * Part floor: the customer's part floor (`internal` for the shop's own parts, which have no customer),
 * raised to export_controlled when `export_control` is `ear_controlled` or `itar`. `ear99` and `none` don't
 * raise it.
 */
export function derivePartFloor(
  part: { exportControl: ExportControl },
  customer: { partClassificationFloor: Classification } | null,
): Classification {
  const base: Classification = customer ? customer.partClassificationFloor : "internal";
  const controlled = part.exportControl === "itar" || part.exportControl === "ear_controlled";
  return maxClass(base, controlled ? "export_controlled" : "general");
}

/** Quote floor = the part's (effective) classification. */
export function deriveQuoteFloor(partClass: Classification): Classification {
  return partClass;
}

/** Job floor = its quote's (effective) classification, or its part's for an internal work order. */
export function deriveJobFloor(quoteClassOrPartClass: Classification): Classification {
  return quoteClassOrPartClass;
}

export interface CardFloorArgs {
  /** Classification of the source interview / quote log; null for seed-binder and manual cards. */
  sourceInterviewClass: Classification | null;
  /** Hidden manual-entry sessions are provenance only and never contribute to the card's floor. */
  isManualEntrySource: boolean;
  /** Customer/part/job/quote link levels. Typed links of a reference kind (machine, material, person) are ignored. */
  linkedRecordClasses: readonly ClassInput[];
  /** Levels of entities mentioned in the card's text fields (detector output may be passed as is). */
  textMentions: readonly ClassInput[];
}

/**
 * Card floor = max(source interview, customer/part/job/quote links, content). Machine, material and person
 * links don't raise it; manual-entry sources don't contribute.
 */
export function deriveCardFloor(args: CardFloorArgs): Classification {
  const source = args.isManualEntrySource ? null : args.sourceInterviewClass;
  return maxClass(
    source ?? "general",
    ...raisingClasses(args.linkedRecordClasses),
    ...raisingClasses(args.textMentions),
  );
}

/** Default card level: max(floor, internal). `general` must be declared explicitly (and needs a general floor). */
export function defaultCardClass(floor: Classification): Classification {
  return maxClass(floor, "internal");
}

export interface InterviewFloorArgs {
  /** Linked quote / job / part / customer levels (the interview's context). */
  contextClasses: readonly ClassInput[];
  /** The level chosen at consent; null when none was chosen. */
  consentLevel: Classification | null;
  /** Levels of entities mentioned in the transcript turns. */
  textMentions: readonly ClassInput[];
}

/** Interview (transcript) floor = max(context, consent level, content), at least `internal`. */
export function deriveInterviewFloor(args: InterviewFloorArgs): Classification {
  return maxClass(
    "internal",
    ...raisingClasses(args.contextClasses),
    args.consentLevel ?? "general",
    ...raisingClasses(args.textMentions),
  );
}

export interface DocumentFloorExtras {
  /** Linked part/job levels (a setup sheet's part or job), if the caller wants them counted. */
  linkedRecordClasses?: readonly ClassInput[];
  /** Levels of entities mentioned in the document body. */
  textMentions?: readonly ClassInput[];
}

/**
 * Document / quiz floor = max of the source cards (at pinned versions); `general` when there are none.
 * Optional extras add the content scan of the body and any linked records.
 */
export function deriveDocumentFloor(
  sourceCardClasses: readonly Classification[],
  extras: DocumentFloorExtras = {},
): Classification {
  return maxClass(
    ...sourceCardClasses,
    ...raisingClasses(extras.linkedRecordClasses),
    ...raisingClasses(extras.textMentions),
  );
}

/** Quizzes follow the document rule. */
export const deriveQuizFloor = deriveDocumentFloor;

export interface PhotoFloorArgs {
  /** Levels of the records the photo/capture is linked to (job, part, …). */
  linkedRecordClasses: readonly ClassInput[];
  /** True when a job is linked; otherwise the machine's recent jobs stand in for it. */
  jobLinked: boolean;
  /** Levels of jobs in process on the photo's machine in the last 30 days (used only when no job is linked). */
  recentMachineJobClasses?: readonly Classification[];
  /** Levels of entities mentioned in a caption or note. */
  textMentions?: readonly ClassInput[];
}

/**
 * Photo / capture floor = max(linked records; with no job linked, the jobs in process on that machine in the
 * last 30 days; content), at least `internal`. A photo can show a controlled part even if metadata is stripped.
 */
export function derivePhotoFloor(args: PhotoFloorArgs): Classification {
  return maxClass(
    "internal",
    ...raisingClasses(args.linkedRecordClasses),
    ...(args.jobLinked ? [] : (args.recentMachineJobClasses ?? [])),
    ...raisingClasses(args.textMentions),
  );
}

/** Captures (voice, note, photo) follow the photo rule. */
export const deriveCaptureFloor = derivePhotoFloor;

/** Generated outputs inherit max(sent sources, request floor) (PLAN.md §4.2 R4). */
export function deriveGeneratedFloor(sentClasses: readonly Classification[], requestFloor: Classification): Classification {
  return maxClass(requestFloor, ...sentClasses);
}

// ---------------------------------------------------------------------------------------------------------
// Resolution and recomputation
// ---------------------------------------------------------------------------------------------------------

export interface ResolveArgs {
  /** The derived floor. */
  floor: Classification;
  /** The level used when nothing is declared (never below the floor; raised to it if it is). */
  defaultClass: Classification;
  /** An explicitly declared level (seed file or owner edit). */
  declared?: Classification;
  /** Required whenever `declared` lies below the floor. */
  override?: ClassificationOverride;
  /** Noun used in messages ("card", "part", …). Defaults to "record". */
  subject?: string;
}

export interface ResolvedClassification {
  classification: Classification;
  source: ClassificationSource;
  /** The override reason (trimmed) for override_up / override_down; null for derived levels. */
  reason: string | null;
  /**
   * Set when the input is inconsistent. The returned classification then fails safe: never below the default
   * (or the declared level, if that is higher), with source `derived`.
   */
  error?: string;
  /** Set for a raise without an explicit override: accepted (raising is always safe), but it has no reason. */
  warning?: string;
}

/**
 * Resolve the stored classification from the floor, the default and an optional declared level/override.
 *
 * - Nothing declared → the default (`derived`).
 * - Declared between the floor and the default → `derived` (this is how a card is set to `general`, which is
 *   possible only when its floor is `general`).
 * - Declared below the floor → error unless `override.direction === "down"` with a reason (`override_down`).
 * - Declared above the default → `override_up` (with the override's reason, or a warning when none was given).
 * - An override whose direction contradicts the declared level, or with an empty reason, is an error.
 */
export function resolveClassification(args: ResolveArgs): ResolvedClassification {
  const { floor, declared, override } = args;
  const subject = args.subject ?? "record";
  const defaultClass = maxClass(args.defaultClass, floor);
  const failSafe = (error: string): ResolvedClassification => ({
    classification: maxClass(defaultClass, declared ?? "general"),
    source: "derived",
    reason: null,
    error,
  });

  if (override) {
    const reason = override.reason.trim();
    if (declared === undefined) {
      return failSafe(`An override (direction ${override.direction}) needs the classification it sets.`);
    }
    if (!reason) {
      return failSafe(`Changing a ${subject}'s classification by override needs a reason.`);
    }
    if (override.direction === "down") {
      if (!classBelow(declared, defaultClass)) {
        return failSafe(
          `The override lowers the classification, but '${declared}' is not lower than the derived '${defaultClass}'.`,
        );
      }
      return { classification: declared, source: "override_down", reason };
    }
    if (!classBelow(defaultClass, declared)) {
      return failSafe(
        `The override raises the classification, but '${declared}' is not higher than the derived '${defaultClass}'.`,
      );
    }
    return { classification: declared, source: "override_up", reason };
  }

  if (declared === undefined) return { classification: defaultClass, source: "derived", reason: null };
  if (classBelow(declared, floor)) {
    return failSafe(
      `'${declared}' is lower than the records this ${subject} comes from ('${floor}'). ` +
        `Raise it to at least '${floor}', or have the owner lower it with an override and a reason.`,
    );
  }
  if (classBelow(defaultClass, declared)) {
    return {
      classification: declared,
      source: "override_up",
      reason: null,
      warning: `'${declared}' is higher than the derived '${defaultClass}'; record a reason for raising it.`,
    };
  }
  return { classification: declared, source: "derived", reason: null };
}

/**
 * Automatic recomputation only ever raises. When the recomputed floor is lower than the current level, the
 * record keeps its level and is flagged "may be over-classified: review" for the owner.
 */
export function recomputeOnlyRaises(
  current: Classification,
  recomputed: Classification,
): { next: Classification; flagOverClassified: boolean } {
  return { next: maxClass(current, recomputed), flagOverClassified: classBelow(recomputed, current) };
}
