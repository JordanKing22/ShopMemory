---
# Interview transcript. Turn IDs are INT-03-T001, INT-03-T002, … Internal context: the shop's own DMU 50 dovetail
# fixture plate (no customer). Never name a customer or a customer part, job or quote number in this transcript.
# Cards cite exact phrases from EXPERT turns, so if you edit an expert turn, run `npm run seed:check`.
# Placeholder domain wording — for SME review.
id: INT-03
title: 5-axis workholding and fixtures
mode: full_interview
plan: generic
expert: PER-02
run_by: P-OWNER
topic: t-5ax-workholding
context: { quote: null, job: J-I01, part: PRT-I01, customer: null }
classification: internal
started_at: "2026-07-21T14:00:00Z"
ended_at: "2026-07-21T14:44:00Z"
speech_engine: typed
consent: { version: consent-v1, granted_at: "2026-07-21T13:57:00Z" }
summary: Marv on holding parts on the DMU 50, the dovetail fixture plate, clearance at steep tilts, proving a new fixture and probing it every time.
---
## T001 interviewer (scope) [SCOPE]
You're the expert here. I don't know your shop, so I'll ask a lot of how and why questions. Nothing becomes shop knowledge until you approve it. Should we focus on 5-axis workholding and fixtures, or something else?

## T002 expert
Workholding is right. On the DMU 50 the program is the easy part. How you hold the part decides whether the tool can even get to it.

## T003 interviewer (task_map) [TASK_MAP]
If you broke holding a new part on the DMU 50 into three to six big steps, what would they be?

## T004 expert
Look at every face the tool has to reach and at what tilt. Decide how you grab it — the dovetail plate, soft jaws, or a fixture of its own. Prep the blank. Prove the setup before a real part goes in. Then probe it every time it goes on the table.

## T005 interviewer (task_map) [TASK_MAP]
Which of those steps takes the most experience to get right?

## T006 expert
Deciding how you grab it. You're picking the clearance for the whole job right there. Grab it too low and the holder hits the jaws at a steep tilt. Grab it too high and the part chatters on the finish passes.

## T007 interviewer (incident) [INCIDENT]
Think of a specific time a workholding decision really mattered. Which one comes to mind?

## T008 expert
The dovetail fixture plate I made in February. We'd been holding 5-axis parts in a regular vise bolted to the DMU table. That vise was the reason we couldn't reach half the features in one setup. So I drew up a plate that grabs the blank by a dovetail, cut it out of 6061 on the VF-4, and we proved it out on the DMU.

## T009 interviewer (timeline) [TIMELINE]
Walk me through that from when you decided to make the plate to the first real part in it.

## T010 expert
Cutting the plate on the VF-4 was about six hours with the setup. Then I put it on the DMU, indicated it in, and dry ran Jonah's program for a part we'd been running in the vise. At full tilt the holder clipped the corner of the plate. I had the rapid turned way down and my hand on feed hold, so it was a scuffed holder and a gouge in the plate, not a crash. Jonah's CAM sim still had the old vise in it, not the plate. We put the real plate model in the sim, moved two toolpaths, and the first real part ran clean the next morning.

## T011 interviewer (timeline) [TIMELINE]
Here's what I have: you cut the plate on the VF-4 in about six hours, put it on the DMU and dry ran the program, the holder clipped the corner of the plate at full tilt because the sim still had the old vise, you put the real plate in the sim and moved two toolpaths, and the first real part ran clean the next morning. What did I miss or get out of order?

## T012 expert
That's it. It clipped because I trusted the sim. Nobody checked what fixture was in it.

## T013 interviewer (deepen) [ASK_WHY]
Why does the dovetail plate let you reach more of the part than the vise did?

## T014 expert
The dovetail only grabs about an eighth of an inch on the bottom of the blank. Everything above that is open. Vise jaws come way up the sides, so at a steep tilt the holder runs into a jaw before the tool gets to the feature. In the dovetail you can get to five sides in one setup.

## T015 interviewer (deepen) [ASK_CONDITION]
When is the dovetail plate the right call? What has to be true about the part?

## T016 expert
Small and mid-size parts that need most of their sides done in the first op, out of bar or plate. The blank has to be taller, because you need extra stock under the part for the dovetail, and the dovetail gets cut on the VF-4 before the blank ever sees the DMU. A big part, or a flat plate, goes in soft jaws or its own fixture instead.

## T017 interviewer (deepen) [ASK_HOW_TELL]
How do you tell how tall to leave the blank?

## T018 expert
I want the part at least 3/4 inch above the top of the jaws. That's what our holders need to clear the jaws at the steepest tilt we run. Less than that and you're betting on the sim. A lot more than that and the part starts to sing on the finish passes.

## T019 interviewer (deepen) [CLARIFY_NUMBER]
3/4 inch measured from where to where, exactly?

## T020 expert
From the top of the dovetail jaws to the lowest feature you have to cut on the part. Not to the bottom of the blank. People measure to the blank and come up short, and that's when the holder finds a jaw.

## T021 interviewer (deepen) [ASK_EXCEPTION]
When would you not hold to that?

## T022 expert
Most of the time I stick to it. If every feature is on top and nothing needs a steep tilt, I'll grab it lower so I can run shorter tools. And if the part is tall, I'd rather make a fixture than leave it hanging up in the air on an eighth of an inch of dovetail.

## T023 interviewer (deepen) [KA_PROBE]
Is there a habit you have every time the plate goes on the machine?

## T024 expert
Every time the plate goes back on the table, I probe it. The bore in the middle and the top face, before the first part. I never trust the old work offset, even if the plate went back on the same dowels. It's two minutes with the probe. A crash is a week.

## T025 interviewer (deepen) [ASK_WHY]
Why the bore and the top face?

## T026 expert
The bore gives me X and Y, the top face gives me Z, and the plate is the one thing that sits the same way every time. Then I probe the blank too, because saw-cut blanks are never the same height. If the dovetail on a blank got cut shallow, the whole part sits low and your clearance is gone.

## T027 interviewer (deepen) [KA_PROBE]
Does any of this show up when a job gets quoted?

## T028 expert
It should. A new fixture is real work: making it, and proving it on the machine. The dovetail plate was about six hours on the VF-4, and proving it took most of a shift on the DMU. When somebody quotes a 5-axis job that needs a new fixture, I usually tell them to put the fixture on its own line, so it doesn't hide in the setup hours. If the part fits the plate we already have, there's no fixture line.

## T029 interviewer (what_if) [WHAT_IF]
If the sim had had the real plate in it, would the dry run still have mattered?

## T030 expert
Yes. I dry run every new fixture at the steepest tilt, rapid turned way down, hand on feed hold. The sim is only as good as the models in it. A wrong holder length in the tool library does the same damage as a missing fixture.

## T031 interviewer (novice_gap) [NOVICE_GAP]
What would a newer machinist most likely get wrong with a setup like this?

## T032 expert
Measuring the clearance to the bottom of the blank instead of the lowest feature. And trusting the sim without asking what fixture is in it. Devin asked me that his second week on the DMU. He's the only one who ever has.

## T033 interviewer (teach_back) [TEACH_BACK]
Let me say it back as a rule: on the dovetail plate, leave the blank tall enough that the part sits at least 3/4 inch above the jaws, and probe the plate every time it goes on the table. What did I get wrong or leave out?

## T034 expert
It's 3/4 inch to the lowest feature you cut, not to the part. And probe the blank too, not just the plate. Otherwise that's right.

## T035 interviewer (wrap) [WRAP]
What should I have asked that I didn't?

## T036 expert
Where the plate lives. It has its own drawer with its dowels, and the probe routine is taped inside the lid. If it sits on the bench it gets dinged, and a dinged dovetail won't hold. And ask Jonah about the fixture models in the sim. He keeps them now.

## T037 interviewer (wrap) [WRAP]
Thanks. I'll turn this into draft cards for you to review.
