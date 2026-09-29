---
# Interview transcript. Turn IDs are INT-04-T001, INT-04-T002, … Customer-confidential context: the Aerovance 7075
# access panel hinge bracket (Q-A05 / J-A05) on the DMU 50.
# Cards cite exact phrases from EXPERT turns, so if you edit an expert turn, run `npm run seed:check`.
# Placeholder domain wording — for SME review.
id: INT-04
title: Five-axis setup on the DMU 50 for the 7075 hinge bracket
mode: full_interview
plan: generic
expert: PER-02
run_by: P-OWNER
topic: t-m-dmu50
context: { quote: Q-A05, job: J-A05, part: PRT-A05, customer: CUS-01 }
classification: customer_confidential
started_at: "2026-08-12T15:00:00Z"
ended_at: "2026-08-12T15:42:00Z"
speech_engine: typed
consent: { version: consent-v1, granted_at: "2026-08-12T14:57:00Z" }
summary: Marv on the 7075 hinge bracket on the DMU 50, the anodize allowance on the hinge bores, edge breaks at tilt and why the setup hours held.
---
## T001 interviewer (scope) [SCOPE]
You're the expert here. I don't know your shop, so I'll ask a lot of how and why questions. Nothing becomes shop knowledge until you approve it. I have the Aerovance hinge bracket job on the DMU 50 open. Should we focus on that setup, or something else?

## T002 expert
That one's good. It went right, and I can tell you why. The access panel hinge bracket. 7075, forty pieces, anodized after machining.

## T003 interviewer (task_map) [TASK_MAP]
If you broke setting up a part like that on the DMU 50 into three to six big steps, what would they be?

## T004 expert
Read the print for the finish notes, before anything gets cut. Pick the workholding. Prove the program at tilt. Run the first piece and get it to Linda. Then run the lot and deburr as you go.

## T005 interviewer (task_map) [TASK_MAP]
Which of those would you least want to hand to someone new, and why?

## T006 expert
Reading the finish notes. On a part that gets anodized, the size you cut isn't the size that ships. The model doesn't show you that. It's a note on the print.

## T007 interviewer (incident) [INCIDENT]
On the hinge bracket job, which moment do you remember most?

## T008 expert
The first piece. I finished the two hinge bores where I always finish a bore, a couple tenths over the low limit. Linda looked at it and asked me where the anodize was going to go. I hadn't read the note.

## T009 interviewer (timeline) [TIMELINE]
Walk me through the job from setup to shipping, with that first piece in it.

## T010 expert
The part fit the dovetail plate we already had, so setup went quick. Ray gave me three and a half hours of setup and that's what it took. I proved the program at tilt and ran the first piece. The print says dimensions apply after anodize, and the hinge bores aren't masked. Our anodizer's number for this coat is about two tenths a side, so a bore closes up about four tenths on the diameter. My bores would have come back under the low limit. We opened the first piece up and moved the offset for the rest. That cost me about half an hour. No scrap. The anodize came back on time and we shipped on time.

## T011 interviewer (timeline) [TIMELINE]
Here's what I have: setup on the dovetail plate took the three and a half hours Ray gave you, you ran the first piece with the hinge bores a couple tenths over the low limit, the print says dimensions apply after anodize and the bores aren't masked, so they'd have closed up under the limit, you opened the first piece up and moved the offset, it cost about half an hour, and it shipped on time with no scrap. What did I miss or get out of order?

## T012 expert
One thing. Linda caught it at first piece, before the lot ran. If it had been caught at incoming after anodize, that's forty parts.

## T013 interviewer (deepen) [ASK_WHY]
Why does the anodize close up the bore?

## T014 expert
The coat grows out of the surface. In a bore it grows in from all the way around, so the diameter loses twice what the coat grows on one side. On an outside diameter it goes the other way and the part gets bigger. The faces grow too, but on this part the faces had plenty of tolerance.

## T015 interviewer (deepen) [ASK_CONDITION]
When does that matter? What has to be true about the feature?

## T016 expert
The tolerance has to be tight compared to what the coat takes, and the feature can't be masked. On this bracket that's the hinge bores and nothing else. If the print says the bores are masked, you finish them to print size and the anodizer plugs them.

## T017 interviewer (deepen) [CLARIFY_NUMBER]
Two tenths a side and four tenths on the diameter. Where do those numbers come from?

## T018 expert
From our anodizer, for this callout on 7075. It's their number, not mine. A different anodize type or a different vendor, you call and ask. Hard coat grows a lot more than this.

## T019 interviewer (deepen) [ASK_HOW_TELL]
How do you tell from the print that a bore is one of those?

## T020 expert
Look at the finish note for the words after anodize or after finish. Then look for a masking note on the bores. If there's no masking note and the bore is tight, I always finish it on the high side. I aim for the low limit plus what the coat takes off the diameter, plus a tenth.

## T021 interviewer (deepen) [ASK_EXCEPTION]
When wouldn't you move the offset like that?

## T022 expert
If the bores are masked, finish to print. And if the finish is something else, like chem film, you ask again. Don't carry my anodize number over to a different finish.

## T023 interviewer (deepen) [KA_PROBE]
You said you deburr as you go. How do you handle that on this part?

## T024 expert
On the hinge bracket I put the edge breaks in the CAM program. A small chamfer mill runs every edge it can reach at tilt, while the part is still in the dovetail. Hand deburr is only what's left after that. It took the hand deburr from about six minutes a part to under two, and the edges all look the same.

## T025 interviewer (deepen) [ASK_WHY]
Why at tilt, while it's still in the dovetail?

## T026 expert
At tilt the chamfer mill gets to the back side of the hinge lugs. By hand you can't reach in there without dinging a bore. And once the part is off the dovetail you've lost your locating. I always do the edge breaks before the part comes off the plate.

## T027 interviewer (deepen) [KA_PROBE]
How did the setup time compare with what Ray quoted?

## T028 expert
Ray had it right, because the part fit the dovetail plate we already had. Load the plate, probe it, prove the program at tilt, first piece to Linda. On a bracket that fits the plate, three and a half hours of setup usually holds. If a bracket like this needs soft jaws cut, or a new fixture, that's more setup, and it should be in the quote. Ray asks me before he quotes a 5-axis job, and that's why his setup numbers hold.

## T029 interviewer (what_if) [WHAT_IF]
If Linda hadn't asked about the anodize at first piece, what would have happened?

## T030 expert
We'd have run all forty with the bores a couple tenths over the low limit. Every one would have come back from the anodizer under size. You can't just open up an anodized bore without cutting through the coat. So that's forty parts to strip and redo, or scrap, and a late shipment.

## T031 interviewer (novice_gap) [NOVICE_GAP]
What would a newer machinist most likely get wrong on this job?

## T032 expert
Cutting to the model instead of the print notes. The model is nominal size. It doesn't know about anodize. And they'd deburr by hand after the part is off the machine, and ding the hinge bores doing it.

## T033 interviewer (teach_back) [TEACH_BACK]
Let me say it back as a rule: on 7075 that gets anodized, finish tight bores on the high side by what the coat takes off the diameter. What did I get wrong or leave out?

## T034 expert
Only if the bore isn't masked, and the number comes from the anodizer for that callout, not from me. And set it before the first piece, not after Linda asks. Otherwise that's right.

## T035 interviewer (wrap) [WRAP]
Who else here knows this well?

## T036 expert
Linda, for reading finish notes. She reads every note on a print before she reads the dimensions. And Ray, because he quotes the anodize as its own line.

## T037 interviewer (wrap) [WRAP]
Thanks. I'll turn this into draft cards for you to review.
