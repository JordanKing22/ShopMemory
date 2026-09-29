---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-12
title: "Integrex: Halvorsen pivot shaft (17-4), bearing diameters sized cold"
machine: m-integrex
part: PRT-G17
job: J-G045
status: expert_review
reviewer: PER-04
source_cards: [KC-063, KC-057, KC-058]
program_refs: ["O5958-10", "O5958-20"]
created_on: "2026-09-10"
---
## Workholding
- Op 10 in the main spindle from bar; op 20 picked off to the sub-spindle.
- Finish both bearing diameters in the main spindle. The sub on RP-M05 sits about three tenths off center. [KC-057]

## Operations
- Op 10: turn the shaft and finish both bearing diameters (program O5958-10). [KC-057]
- Op 20: pick off, face to length and mill the cross hole (program O5958-20). Swing the B-axis in from the same side and let the clamp lock. [KC-058]

## Inspection
- Don't size the bearing diameters with the shaft still warm from the cut. Let it cool before you set the offset. [KC-063]
- The tightest diameter gets measured twice: at the machine once the shaft is cold, and again in inspection. [KC-063]

## Cautions
- On the last lot the shafts were sized warm and came in two tenths under on the tightest diameter the next morning. Every shaft got held and measured twice. [KC-063]
- Runout between the ends after the pick-off: indicate in the sub before you chase it in the program. [KC-057]

## Checklist
- Bearing diameters finished in the main spindle. [KC-057]
- Offset set from a cold part. [KC-063]
- Cross hole checked for location after the first head swing. [KC-058]
