---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-24
title: "Wire EDM: Restart check after a wire break on thick stock"
machine: m-wedm
part: null
job: null
status: expert_review
reviewer: PER-02
source_cards: [KC-011, KC-027]
program_refs: []
created_on: "2026-08-24"
---
## Workholding
- With more than one start hole in a part, mark which hole goes with which profile on the setup print.

## Operations
- After a wire break on thick stock, check the auto-threading restarted on the right start hole before you walk away. [KC-011]
- On thick 17-4, look at the flushing before you blame the wire: flattest face down on the lower nozzle, upper nozzle right down to the part. [KC-027]

## Cautions
- In August it broke wire on thick 17-4 and the auto-threading restarted on the wrong start hole. It was caught before it cut. [KC-011]
- Wire breaks on thick 17-4 are usually the flushing on this unit, not the wire. [KC-027]

## Checklist
- Start hole checked after every restart. [KC-011]
- For review: Marv to confirm the restart check is still needed on RP-M07.
