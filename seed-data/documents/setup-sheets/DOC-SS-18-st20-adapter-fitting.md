---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-18
title: "ST-20: Halvorsen adapter fitting (316), ops 10 and 20"
machine: m-st20
part: PRT-G15
job: J-G040
status: approved
reviewer: PER-04
approved_by: PER-04
approved_on: "2026-09-08"
source_cards: [KC-060, KC-059]
program_refs: ["O2413-10", "O2413-20"]
created_on: "2026-09-07"
---
## Workholding
- Op 10 from the bar feeder; op 20 flipped into soft jaws on the finished diameter.
- If this lot runs from bar under 3/4 inch, fit the matching spindle liner before you load the feeder. [KC-059]

## Tools
| Tool | Holder | Stickout / notes |
|---|---|---|
| Turning insert | OD holder | Chip-breaking insert |
| Drill | Drill holder | Through hole |
| Threading insert | OD threading holder | Thread per the print |
| Cut-off blade | Blade holder | Part off in op 10 |

## Operations
- Op 10: turn, drill the through hole, cut the thread and part off (program O2413-10). Chip-breaking inserts on every turning tool. [KC-060]
- Op 20: flip, face to length and chamfer the back end (program O2413-20).

## Inspection
- Thread gauge on the first piece and after every insert change.

## Cautions
- RP-M02's conveyor jams on stringy 316 chips. Check it every hour, and never leave this job running overnight without that check. [KC-060]

## Checklist
- Chip-breaking inserts loaded. [KC-060]
- Liner checked against the bar size. [KC-059]
- Hourly conveyor check on the sheet. [KC-060]
