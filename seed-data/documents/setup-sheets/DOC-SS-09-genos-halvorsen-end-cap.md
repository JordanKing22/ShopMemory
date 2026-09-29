---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-09
title: "Genos: Halvorsen actuator end cap (17-4), bores finished after heat treat"
machine: m-genos
part: PRT-A08
job: J-A08
status: approved
reviewer: PER-02
approved_by: PER-02
approved_on: "2026-06-17"
source_cards: [KC-005, KC-045, KC-007, KC-025, KC-042]
program_refs: ["O9000", "O2051-10", "O2051-20", "O2051-30"]
created_on: "2026-06-15"
---
## Workholding
- Ops 10 and 20 in the vise on a middle T-slot, indicated after it's bolted down. [KC-025]
- Op 30, after heat treat, in soft jaws on the finished outside diameter.

## Operations
- Op 10: rough the profile and the bores, leaving finish stock on every bore (program O2051-10).
- Op 20: back side and the mounting holes (program O2051-20). Then out for heat treat.
- Incoming: every part back from the heat treater gets a CMM check on the bores before it goes back on a machine. [KC-045]
- Op 30: finish the bores after heat treat, on every part (program O2051-30). Run the warm-up program O9000 first; these bores are under ±0.0005. [KC-005, KC-007]
- Then out for passivation.

## Inspection
- CMM check at incoming from the heat treater and again at final. [KC-045]
- Before the lot ships, check the heat treat and passivation certs: vendor on Halvorsen's approved source list, spec and revision matching the PO, part number and quantity matching our traveler. [KC-042]

## Cautions
- Never finish the bores before heat treat to save a setup. On the first lot they came back out of round. [KC-005]
- Don't send heat-treated parts straight back to the machine without the incoming check. [KC-045]
- A wrong cert gets reissued before the lot ships, not after. [KC-042]

## Checklist
- Incoming CMM report in the job folder before op 30 starts. [KC-045]
- Warm-up run before op 30. [KC-007]
- Certs checked against the PO and the approved source list. [KC-042]
