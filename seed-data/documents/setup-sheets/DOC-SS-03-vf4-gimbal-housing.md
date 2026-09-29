---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-03
title: "VF-4: Graymoor gimbal housing (7075) on the rotary, ops 10 to 30"
machine: m-vf4
part: PRT-G36
job: J-G090
status: approved
reviewer: PER-02
approved_by: PER-02
approved_on: "2026-08-21"
source_cards: [KC-024, KC-044, KC-017]
program_refs: ["O5200-10", "O5200-20", "O5200-30"]
created_on: "2026-08-19"
---
## Workholding
- Op 10 in the VF-4 vise. Ops 20 and 30 in the small vise on the rotary table.
- Every time the rotary goes back on RP-M01, sweep the face and re-find the A-axis center with the probe before op 20. It has never gone back in the same place twice. [KC-024]

## Tools
| Tool | Holder | Stickout / notes |
|---|---|---|
| Spindle probe | — | A-axis center first, then the part |
| Rougher | Shrink fit | Shortest that reaches the side pockets |
| Boring bar | Boring head | Gimbal bores, finish pass only |
| Chamfer mill | Collet chuck | Edge breaks at each index |

## Operations
- Op 10: square the block, face the mounting side, drill and ream the locating holes (program O5200-10).
- Op 20: on the rotary, rough the side pockets and the gimbal bores at each index (program O5200-20). Rotary brake on for the roughing cuts. [KC-024]
- Op 30: on the rotary, finish the gimbal bores and machine the edge breaks (program O5200-30).
- Dimensions apply after anodize. If the gimbal bores aren't masked, finish them at the low limit plus what the coat takes off the diameter, plus a tenth. Get the growth number from the anodizer for this callout before the first piece. [KC-017]

## Inspection
- First article on the CMM. Build the program so any feature runs by itself, named by its balloon number; the source inspector picks a few and has us re-run them while they watch. [KC-044]
- Lay out the first article parts, the ballooned drawing, the CMM reports and every cert before the source inspector walks in. [KC-044]

## Cautions
- Don't use the A-axis center from the last time the rotary was on. [KC-024]
- Don't cut the bores to the model's nominal size. Read the finish note first. [KC-017]
- Drawings and reports stay in the inspection room while the source inspector is here. [KC-044]

## Checklist
- Rotary face swept and A-axis center re-found. [KC-024]
- Anodize growth number written on the traveler. [KC-017]
- CMM program runs feature by feature. [KC-044]
