---
# Interview transcript. Turn IDs are INT-08-T001, INT-08-T002, … Export-controlled context (a defense customer's
# ITAR ring job), so every card drawn from it is export_controlled.
# Cards cite exact phrases from EXPERT turns, so if you edit an expert turn, run `npm run seed:check`.
# Placeholder domain wording — for SME review.
id: INT-08
title: Inconel 718 rings on the Integrex
mode: full_interview
plan: generic
expert: PER-04
run_by: P-OWNER
topic: t-mat-in718
context: { quote: Q-A07, job: J-A07, part: PRT-A07, customer: CUS-05 }
classification: export_controlled
started_at: "2026-08-26T14:00:00Z"
ended_at: "2026-08-26T14:42:00Z"
speech_engine: typed
consent: { version: consent-v1, granted_at: "2026-08-26T13:57:00Z" }
summary: Tomás on turning Inconel 718 rings on the Integrex, insert life, never letting the tool dwell, heat-number traceability, and the seal carrier rings that ran four hours over.
---
## T001 interviewer (scope) [SCOPE]
You're the expert here. I don't know your shop, so I'll ask a lot of how and why questions. Nothing becomes shop knowledge until you approve it. Should we focus on the Inconel rings, or something else?

## T002 expert
The Inconel rings. Everybody knows Inconel is slow. What they don't know is where the time actually goes.

## T003 interviewer (task_map) [TASK_MAP]
If you broke running a batch of those rings into three to six big steps, what would they be?

## T004 expert
Check the bar cert and the heat number. Rough the ring in the main spindle. Pick it off to the sub-spindle and finish the back side. Change inserts before they go, not after. Measure the sealing diameters cold. Keep the paperwork straight the whole way.

## T005 interviewer (task_map) [TASK_MAP]
Which of those would you least want to hand to someone new, and why?

## T006 expert
Changing inserts before they go. On Inconel an insert doesn't wear slow and warn you. It's fine, then it's gone, and it takes the surface with it.

## T007 interviewer (incident) [INCIDENT]
Think of a specific recent job where that really mattered. Which job comes to mind?

## T008 expert
The seal carrier rings in March. Sixteen rings, Inconel 718, on the Integrex, with a first article.

## T009 interviewer (timeline) [TIMELINE]
Walk me through that job from when you priced it to when it shipped.

## T010 expert
I priced it at thirty hours. I used Ray's three times the 17-4 cycle for the cutting and put in one finishing insert per ring. On the first ring the finishing insert was done before I got across the sealing face. We ended up at three inserts a ring, two extra changes on every ring. The rings were good, no scrap, and they shipped on time. It came in at thirty-four hours.

## T011 interviewer (timeline) [TIMELINE]
Here's what I have: priced at thirty hours with three times the 17-4 cycle and one finishing insert per ring, the insert didn't last a ring, you ended up at three a ring, no scrap, and it shipped on time at thirty-four hours. What did I miss or get out of order?

## T012 expert
That's it. The cutting time was right. The insert changes were what I missed. Every change is seven, eight minutes by the time you index it, touch it off and take a check cut. Two extra a ring is fifteen minutes. Sixteen rings, that's the four hours.

## T013 interviewer (deepen) [ASK_WHY]
Why does an insert go that fast on this material?

## T014 expert
Inconel gets harder when you work it. Every pass leaves a hard skin behind. If the next pass is too light, the insert rides on that skin instead of cutting under it, and the edge is gone. And the heat stays in the edge instead of leaving with the chip.

## T015 interviewer (deepen) [ASK_HOW_TELL]
How can you tell an insert is about to go?

## T016 expert
The sound changes first. It goes from a hiss to a squeal. Then the chip color changes. If you wait until you see it on the part, you've got a torn sealing face. On the rings I change the finishing insert on a count now, not on the sound.

## T017 interviewer (deepen) [KA_PROBE]
What do you do at the machine to get more life out of an insert?

## T018 expert
Never let the tool dwell. If the feed stops in the cut, even for a second, it work hardens right there and the next pass hits a hard spot. Keep the feed on through the corners, always. Take at least ten thou on the finish pass so you're under the skin from the pass before. Move the depth a little on each roughing pass so the notch doesn't wear in the same spot on the insert. And flood coolant right at the edge. Never run it dry.

## T019 interviewer (deepen) [ASK_CONDITION]
Does the insert itself matter as much as how you run it?

## T020 expert
It matters. For roughing I use round inserts in a tough carbide grade made for the heat-resistant alloys, with a sharp coated edge. Round inserts spread the wear around. For finishing, a sharp positive insert with a small nose radius. A general-purpose steel grade won't last one ring. And I don't reuse a finishing corner on the next ring, even if it looks okay.

## T021 interviewer (deepen) [KA_PROBE]
Is there something about the customer on these rings that tripped someone up?

## T022 expert
Graymoor wants every ring traceable to the heat number of the bar it came from. We write the heat number on the traveler for every ring, and we never mix two heats in one lot. Their source inspector checks it every time. On an earlier lot somebody cut a ring from a leftover bar of a different heat, and we had to pull it and cut another one.

## T023 interviewer (deepen) [CLARIFY_NUMBER]
You said seven, eight minutes a change. Is that the same for roughing and finishing inserts?

## T024 expert
Roughing is quicker. You index it and go. The finishing insert is the eight minutes, because you touch it off and take a check cut on the sealing diameter before you trust it.

## T025 interviewer (deepen) [KA_PROBE]
How do you price a repeat ring job now?

## T026 expert
Before I price a repeat Inconel ring, I pull the old traveler and count the inserts we actually used. I always do that now. That's why the guys write every insert change on the traveler. We got burned on the bearing retainer rings in January, and again on these. The last job's actuals beat anything I can figure from a catalog.

## T027 interviewer (what_if) [WHAT_IF]
If you had counted three inserts a ring from the start, would your hours have changed?

## T028 expert
It would have been thirty-four hours instead of thirty. I usually take Ray's three times the 17-4 cycle for the cutting, and then I price the insert changes on top, counted per ring. Ray's number is right for the cutting. It doesn't see the tool changes.

## T029 interviewer (novice_gap) [NOVICE_GAP]
What would a newer machinist most likely get wrong on these rings?

## T030 expert
They'd take a light spring pass to clean up the finish, like on stainless. On Inconel that just rubs and makes it harder. And they'd run an insert until it squeals because inserts cost money. A torn sealing face costs more.

## T031 interviewer (teach_back) [TEACH_BACK]
Let me say it back as a rule: on these rings, never let the tool dwell, take at least ten thou on the finish pass, and add the insert changes on top of the cutting time. What did I get wrong or leave out?

## T032 expert
Add the count. Change the finishing insert on a count, not when it squeals. Otherwise that's right.

## T033 interviewer (wrap) [WRAP]
Who else here knows this well?

## T034 expert
Ray, on the pricing side. And Linda, she measures the sealing diameters. She won't take a ring off the machine for inspection until it's cold, because they grow when they're warm.

## T035 interviewer (wrap) [WRAP]
Thanks. I'll turn this into draft cards for you to review.
