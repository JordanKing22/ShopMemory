---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-11
title: "Integrex: Graymoor seal carrier ring (Inconel 718), main and sub-spindle"
machine: m-integrex
part: PRT-A07
job: J-A07
status: approved
reviewer: PER-04
approved_by: PER-04
approved_on: "2026-09-08"
source_cards: [KC-054, KC-055, KC-056, KC-057, KC-058]
program_refs: ["O3120-10", "O3120-20"]
created_on: "2026-09-03"
---
## Workholding
- Op 10 in the main spindle from bar; pick off to the sub-spindle for op 20.
- RP-M05's sub-spindle sits about three tenths off the main's center. Finish both sealing diameters in the main spindle, or indicate the ring in the sub before you trust the pick-off. [KC-057]

## Tools
| Tool | Holder | Stickout / notes |
|---|---|---|
| Roughing insert | Turning holder | Round insert, tough carbide grade made for the heat-resistant alloys |
| Finishing insert | Turning holder | Sharp positive insert, small nose radius; changed on a count |
| Drill | Milling head | Cross holes, op 20 |

## Operations
- Op 10: rough and finish the main-spindle side (program O3120-10). Keep the feed on through the corners; never let the tool dwell. [KC-054]
- Take at least ten thou on the finish pass, and move the depth a little on each roughing pass so the notch doesn't wear in the same spot. [KC-054]
- Flood coolant right at the edge. Never run it dry. [KC-054]
- Op 20: pick off, finish the back side and drill the cross holes (program O3120-20). Swing the B-axis in from the same side and let the clamp lock before the first cut. [KC-058]

## Inspection
- Measure the sealing diameters cold. Linda won't take a ring off the machine for inspection until it's cold.
- Cross holes off location by about a thou: check which side the head swung in from. [KC-058]

## Cautions
- A finishing insert may not last one ring. The first lot needed three a ring, two extra changes on every ring. [KC-055]
- Write the bar's heat number on the traveler for every ring. One heat per lot; never cut a ring from a leftover bar of another heat. [KC-056]
- Don't take a light spring pass to clean up the finish. It rubs and hardens the surface. [KC-054]

## Checklist
- Bar cert and heat number on the traveler. [KC-056]
- Finishing inserts counted out for the lot; every change written on the traveler. [KC-055]
- Head swing side matches the posted program. [KC-058]
