---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-13
title: "Integrex: Sub-spindle stop (RP-FX-103), make it and fit it on RP-M05"
machine: m-integrex
part: PRT-I03
job: J-I03
status: approved
reviewer: PER-04
approved_by: PER-04
approved_on: "2026-06-26"
source_cards: [KC-057, KC-058]
program_refs: ["O9103-10", "O9103-20"]
created_on: "2026-06-24"
---
## Workholding
- Op 10 in the main spindle from 17-4 bar; op 20 picked off to the sub-spindle.
- Finish the locating diameter and the stop face in the main spindle. Our sub sits about three tenths off the main's center. [KC-057]

## Operations
- Op 10: turn the locating diameter and the stop face (program O9103-10). [KC-057]
- Op 20: pick off, face to length and mill the bolt holes (program O9103-20). Swing the B-axis in from the same side and let the clamp lock before the first cut. [KC-058]
- Fit the stop in the sub-spindle and indicate it before the first job runs against it. [KC-057]

## Inspection
- Check the stop face square to the locating diameter before it's fitted.
- Bolt holes off location by about a thou: check which side the head swung in from. [KC-058]

## Cautions
- Don't trust the pick-off to hold the stop true. Indicate it in the sub. [KC-057]

## Checklist
- Stop indicated in the sub-spindle; the reading written in the machine log. [KC-057]
- Program posted with the same B-axis approach as every other RP-M05 program. [KC-058]
