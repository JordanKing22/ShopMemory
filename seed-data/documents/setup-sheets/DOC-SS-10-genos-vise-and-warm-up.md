---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-10
title: "Genos: Vise placement and morning warm-up on RP-M04"
machine: m-genos
part: null
job: null
status: approved
reviewer: PER-02
approved_by: PER-02
approved_on: "2025-12-05"
source_cards: [KC-025, KC-007]
program_refs: ["O9000"]
created_on: "2025-12-03"
---
## Workholding
- Bolt vises on the middle T-slots. Since the 2023 crash the far-left slot has a peened edge, and a vise there rocks. [KC-025]
- If you have to use the left slot, indicate the vise and shim it. [KC-025]
- Indicate every vise after you bolt it down on this machine, middle slots too. [KC-025]

## Operations
- First thing in the morning, run the warm-up program O9000 before any bore under ±0.0005. [KC-007]
- Log the warm-up on the machine sheet so the next shift knows it ran.

## Inspection
- Check the first tight bore of the morning before running the rest. A small first bore means the warm-up was skipped. [KC-007]

## Cautions
- Since the 2023 spindle rebuild this spindle grows as it warms. Tight bores cut on a cold machine come out wrong. [KC-007]
- A vise that rocks or won't indicate flat: move it off the left slot before you start shimming. [KC-025]

## Checklist
- Warm-up run and logged. [KC-007]
- Vise on a middle slot and indicated. [KC-025]
