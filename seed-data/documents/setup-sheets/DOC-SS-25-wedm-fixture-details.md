---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-25
title: "Wire EDM: Keyways and sharp inside corners in fixture details"
machine: m-wedm
part: null
job: null
status: approved
reviewer: PER-02
approved_by: PER-02
approved_on: "2026-08-19"
source_cards: [KC-027, KC-037, KC-039]
program_refs: []
created_on: "2026-08-17"
---
## Workholding
- Clamp the detail on the table bars and indicate the datum edge before you pick up anything.
- On 17-4 over two inches thick, flattest face down on the lower nozzle and the upper nozzle right down to the part. [KC-027]

## Operations
- Pick up the start hole off the indicated edge and write the pickup on the setup print.
- Rough pass, then the skim passes in the program; don't skip a skim on a locating feature.

## Inspection
- The CMM program aligns to the datums on the fixture drawing, not to the edge we picked up on the wire. [KC-037]
- Tight wire-cut holes get scanned, or at least eight points at two depths, never three. [KC-039]

## Cautions
- Wire breaks on thick stock are usually our weak lower flush, not the wire. [KC-027]

## Checklist
- Start hole and pickup edge marked on the setup print.
- Detail to the CMM before it's fitted. [KC-037]
