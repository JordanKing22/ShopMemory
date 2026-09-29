---
# Interview transcript. Turn IDs are INT-05-T001, INT-05-T002, … Customer-confidential context (an Aerovance job).
# Cards cite exact phrases from EXPERT turns, so if you edit an expert turn, run `npm run seed:check`.
# Placeholder domain wording — for SME review.
id: INT-05
title: First article on the Aerovance harness-clip bracket
mode: full_interview
plan: generic
expert: PER-03
run_by: P-OWNER
topic: t-fai-cmm
context: { quote: Q-A04, job: J-A04, part: PRT-A04, customer: CUS-01 }
classification: customer_confidential
started_at: "2026-06-24T14:30:00Z"
ended_at: "2026-06-24T15:07:00Z"
speech_engine: typed
consent: { version: consent-v1, granted_at: "2026-06-24T14:27:00Z" }
summary: Linda on first articles for Aerovance — ballooning to their characteristic IDs, notes as characteristics, and the harness-clip rev D package that came back.
---
## T001 interviewer (scope) [SCOPE]
You're the expert here. I don't know your shop, so I'll ask a lot of how and why questions. Nothing becomes shop knowledge until you approve it. Should we focus on first articles, or something else?

## T002 expert
First articles. On most jobs the machining is the part everybody watches. The first article is where a good part still gets sent back.

## T003 interviewer (task_map) [TASK_MAP]
If you broke a first article into three to six big steps, what would they be?

## T004 expert
Get the customer's drawing and make sure it's the right revision. Balloon it, every dimension and every note, so our numbers match their characteristic IDs. Write or fix the CMM program. Run the first piece and check what the CMM can't. Then fill in their forms and attach the certs.

## T005 interviewer (task_map) [TASK_MAP]
Which of those steps takes the most experience to get right?

## T006 expert
Ballooning. Deciding what counts as a characteristic. The dimensions are easy. The notes are where people miss things — edge breaks, marking, the finish note, the material spec. Every one of those is a characteristic and gets a balloon.

## T007 interviewer (incident) [INCIDENT]
Think of a specific recent job where the ballooning really mattered. Which job comes to mind?

## T008 expert
The Aerovance harness clip in February. Rev D, thirty pieces, first article on the first piece off the DMU. The package came back from Aerovance the day after we sent it.

## T009 interviewer (timeline) [TIMELINE]
Walk me through that job from when the drawing came in to when the package was accepted.

## T010 expert
The rev D drawing came in with the PO. I handed the first article to Priya. She pulled the rev C folder, the old ballooned drawing and the old CMM program, and worked from those. Rev D added a hole. She added the new hole at the end as balloon sixty-three, the way you'd do it on our own format. Aerovance had put it in as characteristic twenty-one and renumbered everything after it. Marv ran the first piece, it measured good, and we sent the package on a Thursday. Friday morning their quality engineer kicked the whole package back. We re-ballooned off the rev D drawing and redid the report Friday and Monday. The parts still shipped on time, but it cost us most of two days.

## T011 interviewer (timeline) [TIMELINE]
Here's what I have: the first article was started from the rev C folder, the new hole went on at the end as balloon sixty-three, Aerovance had it as twenty-one and renumbered after it, the package went out Thursday and came back Friday, and redoing it took most of two days. What did I miss or get out of order?

## T012 expert
That's the order. But it wasn't Priya's fault. I handed it to her and didn't tell her Aerovance renumbers on a new rev. That one's on me.

## T013 interviewer (deepen) [ASK_WHY]
Why does the numbering matter so much to them?

## T014 expert
Their receiving inspection loads our numbers against their characteristic list. If balloon twenty-one on our report isn't characteristic twenty-one on their drawing, nothing lines up and they stop reading. They reject the package, not the parts.

## T015 interviewer (deepen) [ASK_HOW_TELL]
How can you tell, before you start, that a new rev is going to renumber?

## T016 expert
You can't tell by looking at what changed. That's the trap. So I never start a new rev from the old ballooned drawing. I balloon the new drawing from scratch and check our numbers against their characteristic list line by line before the CMM program gets touched.

## T017 interviewer (deepen) [ASK_EXCEPTION]
Is there a case where you'd reuse the old ballooned drawing?

## T018 expert
A repeat order on the same rev, sure. Same drawing, same numbers, same program. But a new rev, even if the only change is a note, gets a full first article. Aerovance won't take a partial first article on a new revision. Every characteristic gets measured again and reported, every time.

## T019 interviewer (deepen) [KA_PROBE]
Besides the numbers, what gets a package sent back?

## T020 expert
Notes with no result. Most of the time when a package comes back from anybody, it's a note nobody ballooned — break sharp edges, part marking, the finish. The CMM report isn't the first article. Anything the CMM can't measure still needs its own line, with the result and how you checked it: visual, gauge pin, profilometer, the cert number.

## T021 interviewer (deepen) [ASK_CONDITION]
Is there anything Aerovance wants in the package that others don't?

## T022 expert
They want it in their own template, not ours. And they want the raw CMM printout behind the form, with our balloon numbers on the printout too. If the printout says circle twelve and the form says balloon twenty-one, that's another kickback. So I name the features in the CMM program by balloon number.

## T023 interviewer (deepen) [CLARIFY_NUMBER]
You said redoing it cost most of two days. How long does a first article like that take when it goes right?

## T024 expert
When it goes right, a first article like the harness clip is about three hours all in, and that's with a CMM program we could edit from rev C. Ballooning and checking the numbers is an hour of that. The CMM run is the short part. A new part number with no program, figure a full day. The time usually goes with the balloon count, not the size of the part. The harness clip is small and it has sixty-three balloons.

## T025 interviewer (deepen) [KA_PROBE]
Who gets that information when the job is being quoted?

## T026 expert
Ray calls me before he quotes anything with a first article. I tell him the balloon count and whether we already have a program. He quotes the first article as its own time, not buried in the cycle.

## T027 interviewer (what_if) [WHAT_IF]
If Priya had known about the renumbering up front, what would have been different?

## T028 expert
She'd have ballooned rev D fresh and caught it in ten minutes against their list. Nothing on the parts would have changed. The parts were good the whole time. We'd have saved the two days and a phone call with their quality engineer.

## T029 interviewer (novice_gap) [NOVICE_GAP]
What would a newer inspector most likely get wrong on a first article like this?

## T030 expert
Trust the old folder. And think the CMM report is the whole job. They'll measure every dimension perfectly and forget the notes and the certs.

## T031 interviewer (teach_back) [TEACH_BACK]
Let me say it back as a rule: on a new rev, balloon the new drawing from scratch and check the numbers against their characteristic list before the CMM program gets touched. What did I get wrong or leave out?

## T032 expert
Add the notes. Every note gets a balloon and a result, not just the dimensions. Otherwise that's right.

## T033 interviewer (wrap) [WRAP]
What should I have asked that I didn't?

## T034 expert
What happens after it's accepted. The accepted package goes in the job folder, and the ballooned drawing goes in the part folder marked with the rev, so a repeat order starts from the right one. And ask Priya about this one too. She'd tell it better than I did.

## T035 interviewer (wrap) [WRAP]
Thanks. I'll turn this into draft cards for you to review.
