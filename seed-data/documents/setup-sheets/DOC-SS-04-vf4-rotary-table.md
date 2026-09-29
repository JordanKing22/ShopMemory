---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-04
title: "VF-4: Putting the rotary table back on RP-M01 and finding A-axis center"
machine: m-vf4
part: null
job: null
status: draft
reviewer: PER-02
source_cards: [KC-024]
program_refs: ["O9030"]
created_on: "2026-09-10"
---
## Workholding
- Clean the table and the rotary base before the rotary goes down on its keys at the right end of the table.

## Operations
- Sweep the rotary face with an indicator. [KC-024]
- Re-find the A-axis center with the probe (program O9030) and update the work offset for every job that uses the rotary. [KC-024]
- Check the rotary brake holds before the first heavy cut. It was checked at the September PM before the rotary went back on.

## Cautions
- Since we added the rotary in 2016 it has never gone back in the same place twice. Don't reuse the A-axis center from last time. [KC-024]
- No heavy cuts with the rotary brake off. [KC-024]

## Checklist
- Face swept, A-axis center re-found, offsets updated. [KC-024]
- To add before review: the sweep reading we accept on the rotary face.
