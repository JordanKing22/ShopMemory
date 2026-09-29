---
# Interview transcript. Turn IDs are INT-06-T001, INT-06-T002, … Internal: shop practice only. Never name a customer
# or a customer part, job or quote number in this file (it would raise the transcript's classification).
# Cards cite exact phrases from EXPERT turns, so if you edit an expert turn, run `npm run seed:check`.
# Placeholder domain wording — for SME review.
id: INT-06
title: CMM programming and inspection practice
mode: full_interview
plan: generic
expert: PER-03
run_by: P-OWNER
topic: t-m-cmm
context: { quote: null, job: null, part: null, customer: null }
classification: internal
started_at: "2026-08-04T14:00:00Z"
ended_at: "2026-08-04T14:36:00Z"
speech_engine: typed
consent: { version: consent-v1, granted_at: "2026-08-04T13:57:00Z" }
summary: Linda on CMM practice — letting parts soak to room temperature, holding them lightly, aligning to the print datums, and taking enough points on a tight bore.
---
## T001 interviewer (scope) [SCOPE]
You're the expert here. I don't know your shop, so I'll ask a lot of how and why questions. Nothing becomes shop knowledge until you approve it. Should we focus on the CMM, or something else?

## T002 expert
The CMM. It's the machine everybody trusts and nobody questions. It'll give you a number to four places whether the number means anything or not.

## T003 interviewer (task_map) [TASK_MAP]
If you broke checking a part on the CMM into three to six big steps, what would they be?

## T004 expert
Let the part come to room temperature. Hold it so it can't move but isn't squeezed. Align to the datums on the print. Measure the features with enough points to mean something. Then read the report like you don't believe it.

## T005 interviewer (task_map) [TASK_MAP]
Which of those steps takes the most experience to get right?

## T006 expert
The alignment. Picking what you align to. The machine does exactly what you tell it, and if you align to the wrong thing, every number on the report is perfect and wrong.

## T007 interviewer (incident) [INCIDENT]
Think of a specific part where the alignment really mattered. Which one comes to mind?

## T008 expert
An aluminum housing a couple of years back. Two bores and a bolt pattern, all positioned off the mounting face on the bottom. Datum A was that bottom face.

## T009 interviewer (timeline) [TIMELINE]
Walk me through what happened with that housing.

## T010 expert
The machinist held it on the bottom face and did the top and the bores in one op. I wrote the CMM program myself, and I aligned it to the top face and the first bore, because that's how the part sat in the vise. Every part passed here. The customer checked them off the bottom face, the way the print says, and the bore positions were out on a third of the lot. We made the lot again.

## T011 interviewer (timeline) [TIMELINE]
Here's what I have: the part was held on the bottom face, the program was aligned to the top face and the first bore, every part passed here, the customer checked from the bottom face and a third of the lot was out, and the lot was made again. What did I miss or get out of order?

## T012 expert
You missed why. The top face wasn't parallel to the bottom. My program couldn't see that, because it started from the top face. Otherwise that's it.

## T013 interviewer (deepen) [ASK_WHY]
Why did aligning to the top face hide it?

## T014 expert
Because you're measuring the part against the way it was made. Align to how the part was held and you're checking the machine's repeatability, not the part. The print datums are how the part gets used. So I always align to the datums on the print, never to the faces the machinist clamped on.

## T015 interviewer (deepen) [ASK_HOW_TELL]
How can you tell a program was aligned the wrong way?

## T016 expert
Look at the alignment at the top of the program and hold it next to the datum frame on the print. If the alignment uses a feature that isn't a datum, stop and ask why. And be suspicious when a whole lot comes out dead nominal. Real parts wander a little.

## T017 interviewer (deepen) [ASK_EXCEPTION]
Is there a time you'd align to something other than the print datums?

## T018 expert
In-process, sure. If Marv wants to know where the machine is putting a bore relative to his setup, I'll run it off his setup faces. But that report never goes in the job folder as the inspection. I write setup check across the top of it.

## T019 interviewer (deepen) [KA_PROBE]
You said the part has to come to room temperature first. Why?

## T020 expert
Parts come off the machine warm, from the cut and the coolant. The inspection room is held at sixty-eight. A warm aluminum part measures big. So I let parts soak on the granite until they're at room temperature before I measure anything tight. For a small aluminum part that's usually an hour. A big stainless block, I leave it overnight.

## T021 interviewer (deepen) [CLARIFY_NUMBER]
When you say it measures big, how big?

## T022 expert
On a two-inch aluminum bore straight off the machine, I've seen two tenths big. If the whole tolerance on that bore is half a thou, that's almost half of it gone before you start. Every time somebody runs a warm part out to me, it's the CMM that's wrong. It isn't.

## T023 interviewer (deepen) [ASK_CONDITION]
Does that apply to every part that comes in?

## T024 expert
Anything tight. Anything under a thou of total tolerance always soaks, no arguments. A loose part at plus or minus five thou, I'm not going to make the floor wait an hour for it.

## T025 interviewer (deepen) [KA_PROBE]
How do you hold a part on the table while it's measured?

## T026 expert
As lightly as it'll let you. Clay, a couple of light clamps, the fixture plate with the rests. It has to sit the way the print datums say, datum A down on the rests if you can. Never clamp across a feature you're measuring, and never clamp hard enough to pull the part flat. If it's a part we'll see again, I take a photo of the setup and put it in the program folder, so the next run sits the same way.

## T027 interviewer (what_if) [WHAT_IF]
If that housing program had been aligned to the bottom face from the start, what would have been different?

## T028 expert
We'd have seen the top face out of parallel on the first piece, before the lot ran. The machinist fixes the setup, and we scrap one part instead of a third of a lot.

## T029 interviewer (novice_gap) [NOVICE_GAP]
What would a newer inspector most likely get wrong on the CMM?

## T030 expert
Take three points on a bore and call it round. A reamed or bored hole can come out lobed, with high spots, and three points can land right on them. It reads perfect and it's out of round. We saw that on a stainless valve body last year: three points said round, the scan said two tenths out. On anything tight I always scan the bore, or take at least eight points, at two depths.

## T031 interviewer (teach_back) [TEACH_BACK]
Let me say it back as a rule: let the part soak to room temperature, hold it lightly the way the datums say, align to the print datums, and scan tight bores instead of taking three points. What did I get wrong or leave out?

## T032 expert
Mostly right. The soak is for tight work, not everything, or the floor will hate me. And I'd put the datums first. That's the one that cost us a whole lot.

## T033 interviewer (wrap) [WRAP]
What should I have asked that I didn't?

## T034 expert
Who checks the checker. Priya's getting good. But somebody should look at the alignment on every new program before it runs parts for record. When I retire, that somebody has to exist.

## T035 interviewer (wrap) [WRAP]
Thanks. I'll turn this into draft cards for you to review.
