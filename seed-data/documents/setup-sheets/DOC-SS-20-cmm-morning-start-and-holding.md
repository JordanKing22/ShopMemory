---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-20
title: "CMM: Morning start, part holding and alignment on RP-Q01"
machine: m-cmm
part: null
job: null
status: approved
reviewer: PER-03
approved_by: PER-03
approved_on: "2026-08-12"
source_cards: [KC-041, KC-040, KC-037, KC-036]
program_refs: []
created_on: "2026-08-10"
---
## Workholding
- Hold the part as lightly as it lets you: clay, a couple of light clamps, or the fixture plate with the rests. [KC-040]
- Sit it the way the print datums say, datum A down on the rests if you can. [KC-040]
- Never clamp across a feature you're measuring, and never hard enough to pull the part flat. [KC-040]

## Operations
- First thing, check the air pressure gauge and drain the filter bowl before anything runs. [KC-041]
- After a stylus bump or a missed change at rack port 4, re-qualify the stylus before the next part.
- Anything under a thou of total tolerance soaks on the granite to room temperature first: about an hour for a small aluminum part, overnight for a big stainless block. [KC-036]
- Align the program to the datums on the print, never to the faces the part was clamped on. [KC-037]

## Inspection
- Hold the program's alignment next to the datum frame on the print before it runs parts for record. [KC-037]
- A report run off the machinist's setup faces gets "setup check" written across the top and never goes in the job folder as the inspection. [KC-037]

## Cautions
- Low air or water in the bowl, and the first readings of the day wander. Don't blame the part. [KC-041]
- A warm part measures big. When somebody runs a warm part out, it isn't the CMM that's wrong. [KC-036]
- A whole lot that comes out dead nominal is a reason to look at the alignment. [KC-037]

## Checklist
- Air gauge checked and filter bowl drained. [KC-041]
- Tight parts soaked to room temperature. [KC-036]
- Setup photographed for the program folder on any part we'll see again. [KC-040]
