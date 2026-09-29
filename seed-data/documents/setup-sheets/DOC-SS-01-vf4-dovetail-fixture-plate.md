---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-01
title: "VF-4: Dovetail fixture plate for the DMU 50 (RP-FX-101), ops 10 and 20"
machine: m-vf4
part: PRT-I01
job: J-I01
status: approved
reviewer: PER-02
approved_by: PER-02
approved_on: "2026-07-29"
source_cards: [KC-013, KC-014, KC-015, KC-016]
program_refs: ["O9101-10", "O9101-20"]
created_on: "2026-07-27"
---
## Workholding
- Op 10: 6061 plate blank in the VF-4 vise on parallels, vise in the middle of the table.
- Op 20: flip onto the finished bottom and indicate the long edge before the first cut.

## Tools
| Tool | Holder | Stickout / notes |
|---|---|---|
| Face mill | Shell mill arbor | Both faces |
| Dovetail cutter | Short collet chuck | Angle and depth per the plate drawing |
| Boring bar | Boring head | Center bore, finished in op 20 |
| Spindle probe | — | Check the center bore before the plate comes off |

## Operations
- Op 10: face the bottom, drill and ream the dowel holes, drill and tap the mounting holes (program O9101-10).
- Op 20: face the top, cut the dovetail jaws and bore the center bore in the same setup (program O9101-20). The DMU probes that bore for X and Y and the top face for Z every time the plate goes on, so both have to be true to the jaws. [KC-014]
- Hold the jaw height to the drawing. On the DMU the lowest feature you cut sits at least 3/4 inch above the top of the jaws, and every program for the plate is built on that height. [KC-013]

## Inspection
- Check the center bore, the dowel holes and the top face against the drawing before the plate leaves the VF-4. [KC-014]
- Check the jaw height off the top face. If it's off, tell Jonah before anything gets posted for the plate. [KC-013]

## Cautions
- Send the finished plate model to Jonah for the CAM sim before any program runs on it. The first plate got clipped on the dry run because the sim still had the old vise in it. [KC-015]
- Dry run the first program on a new plate at the steepest tilt, rapid turned way down, hand on feed hold. [KC-015]
- A new plate is real work: about six hours on the VF-4 and most of a shift proving it on the DMU. It goes on its own line in the quote, not in the setup hours. [KC-016]

## Checklist
- Plate model sent for the CAM sim. [KC-015]
- Center bore, dowel holes and jaw height checked. [KC-013, KC-014]
- Plate goes in its own drawer with its dowels, probe routine taped inside the lid.
