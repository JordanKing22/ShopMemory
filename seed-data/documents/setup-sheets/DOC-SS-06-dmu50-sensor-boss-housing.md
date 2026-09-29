---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-06
title: "DMU 50: Halvorsen sensor boss housing (17-4), rough, heat treat, finish"
machine: m-dmu50
part: PRT-G12
job: J-G034
status: approved
reviewer: PER-02
approved_by: PER-02
approved_on: "2026-08-26"
source_cards: [KC-028, KC-014, KC-022, KC-023, KC-042]
program_refs: ["O7701-10", "O7701-20"]
created_on: "2026-08-24"
---
## Workholding
- Op 10 in the dovetail plate; the dovetail on the blank gets cut on the VF-4 first. Op 20 in soft jaws cut for the heat-treated part.
- Probe the plate's center bore for X and Y and its top face for Z every time it goes back on the table, then probe each blank. [KC-014]

## Tools
| Tool | Holder | Stickout / notes |
|---|---|---|
| Spindle probe | — | Re-qualified on the ring gauge after any bump |
| Rougher | Shrink fit | Op 10 only, leave finish stock on the bores |
| Boring bar | Boring head | Bearing bore, op 20 |
| Chamfer mill | Collet chuck | Edge breaks on the bores and the sealing face |

## Operations
- Op 10: rough the housing and the sensor boss, leaving finish stock on the bearing bore and the sealing face (program O7701-10).
- Out for heat treat between ops. When the parts come back, check the cert: vendor on Halvorsen's approved source list, spec and revision matching the PO, part number and quantity matching our traveler. [KC-042]
- Op 20: finish the bearing bore, the boss and the sealing face (program O7701-20). The edge breaks on the bore and the sealing face are in the program, cut with the chamfer mill. [KC-028]

## Inspection
- First piece to Linda on the CMM before the lot runs.
- Look at every bore edge and the sealing face: machined break, no hand blending. [KC-028]

## Cautions
- Halvorsen's incoming inspection rejects hand-blended edges on bearing bores and sealing faces. Hand deburr only the outside edges, and never with a file near a bore. [KC-028]
- RP-M03 sits closest to the dock door. On winter mornings run the B and C axis warm-up for twenty minutes, then probe the part, before the boss angle gets cut. [KC-022]
- Any bump to the spindle probe, even a light one, or a stylus change: re-qualify it on the ring gauge before anything else runs. [KC-023]

## Checklist
- Probe qualified; plate and blank probed. [KC-023, KC-014]
- Heat treat cert checked before op 20 starts. [KC-042]
- Edge breaks machined; outside edges only by hand. [KC-028]
