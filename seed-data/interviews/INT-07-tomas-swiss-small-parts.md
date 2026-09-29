---
# Interview transcript. Turn headings are "## T### speaker (phase) [MOVE]"; turn IDs are INT-07-T001, INT-07-T002, …
# Cards cite exact phrases from EXPERT turns, so if you edit an expert turn, run `npm run seed:check`.
# Internal session: never name a customer or a customer part, job or quote number in these turns.
# Placeholder domain wording — for SME review.
id: INT-07
title: Swiss-turning small parts
mode: full_interview
plan: generic
expert: PER-04
run_by: P-OWNER
topic: t-m-swiss
context: { quote: null, job: null, part: null, customer: null }
classification: internal
started_at: "2026-07-15T14:00:00Z"
ended_at: "2026-07-15T14:40:00Z"
speech_engine: typed
consent: { version: consent-v1, granted_at: "2026-07-15T13:57:00Z" }
summary: Tomás on setting up small parts on the Swiss, the guide bushing and bar stock, chip control on 316, PEEK, the part catcher and what to price besides the cycle.
---
## T001 interviewer (scope) [SCOPE]
You're the expert here. I don't know your shop, so I'll ask a lot of how and why questions. Nothing becomes shop knowledge until you approve it. Should we focus on the Swiss, or something else?

## T002 expert
The Swiss is good. Small parts, mostly medical. It runs by itself all night, so people think it's easy. If the setup's off, it makes bad parts all night too.

## T003 interviewer (task_map) [TASK_MAP]
If you broke setting up a new small part on the Swiss into three to six big steps, what would they be?

## T004 expert
Check the bar. Set the guide bushing to it. Load the tools and prove out the first part slow. Get the chips breaking. Then set up the pick-off and the part catcher so the parts come out clean.

## T005 interviewer (task_map) [TASK_MAP]
Which of those steps takes the most experience to get right?

## T006 expert
The bar and the bushing. Everybody wants to jump to the program. But if the bushing isn't right, nothing after it holds size.

## T007 interviewer (incident) [INCIDENT]
Think of a specific recent job where the bar and the bushing really mattered. Which job comes to mind?

## T008 expert
A long run of 316 medical parts last July, with one tight diameter on each.

## T009 interviewer (timeline) [TIMELINE]
Walk me through that job from setup to when it shipped.

## T010 expert
The first bundle of bar ran great. The second day we opened a new bundle and nobody miked it. It was on the small side, so the bushing was loose on it. The parts started to chatter and the tight diameter wandered, a couple tenths one way, then the other. The night guy kept chasing it with offsets. Next morning I miked the bar, it was small, I reset the bushing, and it settled right down. We lost a couple of hours.

## T011 interviewer (timeline) [TIMELINE]
Here's what I have: the first bundle ran fine, a new bundle came in small and wasn't checked, the bushing was loose, the parts chattered and the diameter wandered, offsets chased it overnight, and resetting the bushing fixed it. What did I miss or get out of order?

## T012 expert
One thing. The chips. With the parts chattering, the 316 chips got long and stringy and started wrapping. A couple of parts got marked up on the finished diameter. So it was two problems stacked up.

## T013 interviewer (deepen) [ASK_WHY]
Why does the bar size matter so much on this machine?

## T014 expert
On a Swiss the bar slides through the guide bushing right next to the tool. The bushing is what holds the part while you cut it. If the bushing is loose on the bar, the part moves. If it's too tight, the bar galls and sticks. You set the bushing to the bar you've got, not to the size on the tag.

## T015 interviewer (deepen) [ASK_HOW_TELL]
How can you tell the bar is going to give you trouble before you run it?

## T016 expert
Mike the bar before you set the guide bushing. Three places on a bar, a couple of bars from the bundle. I do it every time we open a new bundle. If the bar varies more than about two tenths from end to end, it's not going to run right in the bushing. That's why we buy ground bar for anything tight now.

## T017 interviewer (deepen) [ASK_EXCEPTION]
When would you not bother?

## T018 expert
Loose work, where nothing on the part is tighter than a couple of thou. Drawn bar is fine for that and I don't fuss over the bushing. Anything with a tight diameter, I check.

## T019 interviewer (deepen) [KA_PROBE]
You mentioned the chips wrapping. What do you do about that?

## T020 expert
316 wants to make one long string. If you don't break it, it wraps around the part and the tool, and it drags across the finished diameter. Always program a peck on the drills and a chip break on the roughing passes. On 316 I don't let a tool make a continuous chip.

## T021 interviewer (deepen) [ASK_CONDITION]
Does that hold for other materials on the Swiss?

## T022 expert
PEEK is its own animal. PEEK grows with heat. A sleeve right out of the catcher measures big, and ten minutes later it's back on size. Keep the tools sharp on PEEK. A dull tool makes heat and pushes a fuzzy burr instead of cutting. Usually I let the parts sit ten minutes before I measure a diameter. And on the pick-off, set the sub-spindle grip light, or it squeezes the sleeve out of round.

## T023 interviewer (deepen) [KA_PROBE]
Is there anything about this particular machine people should know?

## T024 expert
Our L20, RP-M06, has a quirk with the part catcher. Anything shorter than about a quarter inch, the catcher misses it, and it drops into the chips and gets dinged. Since 2021 we run a fine mesh liner in the chip pan under the catcher. We always check the catcher at every bar change.

## T025 interviewer (deepen) [CLARIFY_NUMBER]
You said about a quarter inch. Is that the length of the part?

## T026 expert
Overall length, yes. Longer than that, the catcher grabs them fine. Shorter, you plan on the liner.

## T027 interviewer (deepen) [KA_PROBE]
You price a lot of the turned work. What do people miss on a small Swiss part?

## T028 expert
When I quote small parts on the Swiss, everybody looks at the cycle time. What people miss is the handling: deburr under the scope, measure after they cool, bag and count. On the PEEK sleeves and spacers the handling after the machine takes longer than the cycle. I usually price the handling as its own time per part.

## T029 interviewer (what_if) [WHAT_IF]
If the new bundle had been checked before it was loaded, how would that July run have gone?

## T030 expert
It would have been a boring job, which is what you want. Ten minutes to mike the bar and reset the bushing, instead of a night of chasing offsets.

## T031 interviewer (novice_gap) [NOVICE_GAP]
What would a new setup person most likely get wrong on the Swiss?

## T032 expert
They trust the tag on the bar. And when size moves they reach for the offset instead of asking why it moved. On a Swiss, if size wanders, look at the bushing and the chips first.

## T033 interviewer (teach_back) [TEACH_BACK]
Let me say it back as a rule: mike every new bundle before you set the guide bushing, set the bushing to the bar you've got, and break the chip on 316. What did I get wrong or leave out?

## T034 expert
You forgot the part catcher on short parts. And when size wanders, don't touch the offset until you've looked at the bushing.

## T035 interviewer (wrap) [WRAP]
Who else here knows this well?

## T036 expert
Jonah programmed Swiss machines at his last shop, so he knows the programming side. Devin is learning the setups. Somebody should watch him set a bushing a few times.

## T037 interviewer (wrap) [WRAP]
Thanks. I'll turn this into draft cards for you to review.
