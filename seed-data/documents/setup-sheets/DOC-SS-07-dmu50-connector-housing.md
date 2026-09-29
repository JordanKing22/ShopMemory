---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-07
title: "DMU 50: Graymoor connector housing (7075, anodize), ops 10 and 20"
machine: m-dmu50
part: PRT-G37
job: J-G093
status: approved
reviewer: PER-02
approved_by: PER-02
approved_on: "2026-08-20"
source_cards: [KC-013, KC-014, KC-017, KC-023, KC-044]
program_refs: ["O0985-10", "O0985-20"]
created_on: "2026-08-18"
---
## Workholding
- Op 10 in the dovetail plate. Order the blank tall enough that the lowest feature you cut sits at least 3/4 inch above the top of the jaws. Measure to that feature, not to the bottom of the blank. [KC-013]
- Probe the plate's center bore for X and Y and its top face for Z every time it goes back on the table, then probe each blank. [KC-014]
- Op 20 in soft jaws on the finished connector face.

## Operations
- Op 10: five sides at tilt: connector bores, mounting holes, pockets and edge breaks (program O0985-10).
- Op 20: face off the dovetail stock to height (program O0985-20).
- Dimensions apply after anodize. If the connector bores aren't masked, finish them at the low limit plus what the coat takes off the diameter, plus a tenth. Get the growth number from the anodizer first. [KC-017]

## Inspection
- First article on the CMM, with the program built so each feature runs by itself under its balloon number. [KC-044]
- Have the first article parts, the ballooned drawing, the CMM reports and every cert laid out before the source inspector arrives. [KC-044]

## Cautions
- If the spindle probe gets bumped, even lightly, re-qualify it on the ring gauge before you probe the plate. A light tap threw it about two thou once and it looked fine. [KC-023]
- Don't cut the connector bores to the model's nominal size. Read the finish note first. [KC-017]

## Checklist
- Probe qualified on the ring gauge. [KC-023]
- Plate and blank probed. [KC-014]
- Anodize growth number on the traveler. [KC-017]
