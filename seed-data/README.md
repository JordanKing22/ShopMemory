# seed-data/ — the demo's shop knowledge

Everything Floorwise knows about the fictional shop **Ridgeline Precision (fictional)** lives in this folder: people,
machines, customers, parts, quotes, jobs, knowledge cards, interview transcripts and setup sheets. The app itself
contains no machining facts. **All of it is fictional**, and the domain wording is placeholder text for a machining
subject-matter expert (SME) to review.

You can edit these files in any text editor (VS Code recommended). The expertise matrix is a CSV that opens in Excel.

## The three commands

| Command | When | What it does |
|---|---|---|
| `npm run seed:check` | after **every** edit | Checks every file and explains each problem as `file:line  error  message`. Touches no database, so it's safe while the app runs. On success it saves the last good version (`data/seed-bundle.json`), which **Reset demo** replays. |
| `npm run seed` | to load your edits into the app | Runs the same checks, then resets the database to your data. Safe while the app runs. |
| `npm run seed:lock` | after an edit you mean to keep | Records the new data fingerprint in `seed.lock.json`. Commit it together with your edit. |

A half-finished edit can never break the demo: if `seed:check` fails, Reset demo keeps replaying the last good version.

## Rules that keep the demo working

1. **IDs never change and are never reused.** `PER-01`, `CUS-01`, `PRT-A01`, `KC-001`, `INT-01`, `DOC-SS-05`,
   `m-dmu50`… are permanent (printed QR codes and cached demo answers point at them). Add new records at the end
   with the next free number.
2. **Reserved IDs:** `KC-091`–`KC-094`, `INT-LIVE-RAY` and `DOC-SS-LIVE` are created live during the demo. Don't use them.
3. **Every card must be traceable to the expert's own words.** A card either cites exact phrases from an expert turn
   of a transcript, or (for binder and hand-entered cards) carries the expert's words in `source.text`. Any number in
   a card's title, statement, actions or conditions must appear in those words, written or spoken ("forty thou" and
   "0.040" both count).
4. **No prices** in cards, transcripts or quote notes. Prices live only in the `financials` block of quotes and the
   `account` block of customers, which are never sent to an AI model.
5. **Machine quirks describe this unit's history** ("our DMU 50, asset RP-M03, since the 2024 spindle service…"), never a
   manufacturer or model-wide defect.
6. **New names:** any new company, person or part-number prefix must be web-checked for real companies with that name in
   the same industry, and recorded in `NAMES.yaml` with the date and result.
7. **Demo-critical records** are pinned in `demo/anchors.yaml` (IDs, values like Q-A01's 58 hours, and the risk-map
   numbers). If an edit changes one of them, `seed:check` reports a **demo invariant** error naming it. Changing them
   also means re-recording the cached demo answers.

## Files

| File | What's in it |
|---|---|
| `shop.yaml` | Shop name, `demo_today` (the fixed "today" of the demo: 2026-09-15), random seed, fictional-data notice |
| `NAMES.yaml` | Every fictional name with its real-world collision check |
| `people.yaml` | The 8 knowledge holders. Hire and planned departure dates only — never birth dates or ages. `aliases` = every way the name appears in text |
| `personas.yaml` | The demo's role switcher (the owner persona is not a knowledge holder) |
| `machines.yaml` | The 8 machines, each with *this unit's* history and (later) its recent events |
| `materials.yaml` | The 7 materials and every way people write them (`aliases`) |
| `customers.yaml` | The 6 customers. `part_classification_floor` is the minimum label for their parts. `account` is hidden from most roles and never sent to AI |
| `expertise-matrix.csv` | Who knows what, 0–3 (see below) |
| `taxonomy/topics.yaml` | The 28 heat-map rows |
| `taxonomy/tags.yaml` | Tag vocabulary; a tag's `synonyms` are the words that support it |
| `taxonomy/search-synonyms.yaml` | Words that mean the same thing for search |
| `parts/anchors.yaml` | The 12 hand-written demo parts |
| `parts/internal.yaml` | Shop fixtures and tooling |
| `parts/families.yaml` | Templates the generator uses for the other 44 parts, and each customer's total quote count |
| `quotes/anchors.yaml` | The hand-written demo quotes and their jobs (with debriefs and pricing) |
| `quotes/internal-work-orders.yaml` | Jobs with no quote |
| `quotes/quote-model.yaml` | Knobs for generating the other quotes and jobs (hours, rates, variance, who quotes what) |
| `cards/PER-0n-name.yaml` | Knowledge cards, one file per contributor |
| `interviews/INT-0n-*.md` | Interview transcripts |
| `quote-logs/*.yaml` | Quote Reasoning Logs |
| `documents/setup-sheets/DOC-SS-nn-*.md` | Setup sheets |
| `demo/ray-live-interview.yaml` | Ray's scripted answers for the live interview and the four cards it must produce |
| `demo/anchors.yaml` | Demo-critical IDs, pinned values and the numbers the risk map must show |
| `demo-cache/` | Cached AI answers for the scripted demo (checked by `demo:verify`, not by `seed:check`) |

## The expertise matrix (`expertise-matrix.csv`)

One row per topic, one column per person. Each cell is the person's **tacit** level on that topic:

| Level | Meaning |
|---|---|
| 0 | none |
| 1 | working knowledge |
| 2 | independent; can teach the basics |
| 3 | deep; the go-to person |

- Keep the first row exactly as it is: `topic_id,topic_label,` then one column per person, each starting with the
  person's ID (`PER-01 Ray Delgado`).
- Every topic in `taxonomy/topics.yaml` needs exactly one row, and every person one column.
- An empty cell counts as 0. Excel's "CSV UTF-8" and European `;`-separated CSV both work.
- The risk map's headline numbers depend on this file (Ray is the only single point of failure, on titanium and
  thin-wall). If an edit changes them, `seed:check` names the cell.

## Knowledge cards (`cards/*.yaml`)

```yaml
- id: KC-013                     # next free number in your file's range; never reuse
  type: setup_tip                # quoting_rule | setup_tip | machine_quirk | customer_quirk | inspection_gotcha | failure_story
  status: approved               # draft | pending_review | approved | rejected
  title: "Short rule, at most 90 characters"
  statement: >-
    The rule in a sentence or two, in the expert's voice.
  applies_when: ["…"]            # conditions
  does_not_apply_when: ["…"]     # exceptions
  rationale: "Why it works"      # or null
  cues: ["what you notice"]
  actions: ["what you do"]
  common_mistake: "what a newer person gets wrong"
  thresholds:                    # optional numeric limits, each with the expert's exact words
    - { quantity: wall thickness, comparator: "<", value: 0.040, unit: in, verbatim: "under forty thou" }
  expert_confidence: always      # always | usually | sometimes | not_sure | not_stated
  topics: [t-thin-wall]          # 1–3 heat-map rows
  tags: [thin-wall]              # from taxonomy/tags.yaml
  links: { jobs: [J-A02], machine: m-dmu50 }
  source: { kind: interview, interview: INT-03 }
  evidence:
    - { turn: INT-03-T012, quote: "exact words copied from that expert turn", confidence: true }
  approved: { by: PER-02, on: "2026-05-12", mode: self }   # only for approved cards
  created_on: "2026-05-11"
```

- **Binder or hand-entered cards** use `source: { kind: seed_binder | manual, text: "the expert's own words", note: "…" }`
  and no `evidence` list; the text becomes the evidence.
- **Confidence** other than `not_stated` must be backed by the expert's words ("always", "every time", "usually",
  "sometimes", "it depends"…). Mark that evidence item `confidence: true`. Failure stories are exempt.
- **Links:** quoting rules, setup tips, failure stories and inspection gotchas link at least one job or quote; setup tips
  and machine quirks link a machine; customer quirks link a customer.
- **Topics need support:** a material topic needs the material named (or a linked job/part/quote in that material);
  a machine or customer topic needs that machine or customer linked; a process topic needs one of its tag words.
- **Classification** is worked out for you from links, the source interview and the names mentioned in the text. You
  may set it higher, never lower (`classification: general` is allowed only for cards with no customer, part, job or
  quote links or mentions).

## Transcripts (`interviews/*.md`)

Frontmatter (between `---` lines) describes the session; each turn starts with a heading:

```
## T001 interviewer (scope) [SCOPE]
You're the expert here…

## T002 expert
Outside processing is good…
```

Turns are numbered T001, T002, … in order. Only interviewer turns carry a phase `(…)` and a move `[…]`. Card evidence
cites turns as `INT-01-T010`. If you edit an expert turn, run `seed:check`: any card quoting it must still match exactly.

## Setup sheets (`documents/setup-sheets/*.md`)

Frontmatter lists the machine, part, job, status and `source_cards`. The body uses these sections: `## Workholding`,
`## Tools`, `## Operations`, `## Inspection`, `## Cautions`, `## Checklist`. Each `- ` line may end with the cards it
comes from, like `[KC-002, KC-021]`. Cite CAM program numbers, never speeds or feeds.

## Reading `seed:check` output

```
  seed-data/cards/PER-03-linda-marchetti.yaml:31  error  Card KC-038: topics[0] (t-fai-cmm) has no support — it needs a mention, a matching link or the session topic.
```

Open the file at that line, fix it, and run `npm run seed:check` again. If it says a **generated record changed**
(because someone edited `quotes/quote-model.yaml` or `parts/families.yaml`), re-read the cards it names — they may tell
a story about the old numbers — fix them if needed, then run `npm run seed:lock`. Warnings (for example record counts that differ
from the brief) don't block anything.
