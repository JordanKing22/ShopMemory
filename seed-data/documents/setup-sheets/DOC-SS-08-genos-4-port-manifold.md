---
# Setup sheet (Markdown with this frontmatter block). Sections are "## Workholding", "## Tools", "## Operations",
# "## Inspection", "## Cautions" and "## Checklist". Each "- " line may cite the approved cards it comes from, like
# [KC-002]; every card in source_cards must be cited at least once. Cite CAM program numbers, never speeds or feeds.
# Placeholder domain wording — for SME review.
id: DOC-SS-08
title: "Genos: Graymoor 4-port manifold (17-4), ops 10 to 30"
machine: m-genos
part: PRT-A10
job: J-A10
status: approved
reviewer: PER-02
approved_by: PER-02
approved_on: "2026-05-20"
source_cards: [KC-026, KC-007, KC-025, KC-038]
program_refs: ["O9000", "O4410-10", "O4410-20", "O4410-30"]
created_on: "2026-05-18"
---
## Workholding
- Vise on the middle T-slots. RP-M04's far-left slot has had a peened edge since the 2023 crash, and a vise bolted there rocks. [KC-025]
- Indicate the vise after you bolt it down, every time on this machine. [KC-025]

## Tools
| Tool | Holder | Stickout / notes |
|---|---|---|
| Spot drill | Collet chuck | Every cross port |
| Long drill | Hydraulic chuck | Cross ports, drilled before the pockets are opened |
| Rougher | Shrink fit | Deep pockets, op 30 |
| Boring bar | Boring head | Port bores, after the warm-up |

## Operations
- Run the warm-up program (O9000) before any bore under ±0.0005. [KC-007]
- Op 10: square the block and face to height (program O4410-10).
- Op 20: drill the cross ports before you open the deep pockets (program O4410-20). With the pockets open first, the drill walks when it breaks through. [KC-026]
- Op 30: open the deep pockets and finish the port bores (program O4410-30). Then out for heat treat.

## Inspection
- Sealing-face flatness gets checked on the CMM after heat treat, not before. The faces move in the furnace. [KC-038]
- If the first bores of the morning measure small, the warm-up got skipped. [KC-007]

## Cautions
- Never rough all the pockets first because it's faster. [KC-026]
- Don't sign off flatness before the parts go out for heat treat. [KC-038]

## Checklist
- Warm-up run. [KC-007]
- Vise on a middle slot and indicated. [KC-025]
- Cross ports drilled before the pockets are opened. [KC-026]
