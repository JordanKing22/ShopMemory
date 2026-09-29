import { integer, primaryKey, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { classificationCheck, classificationColumns } from "./_shared";
import { knowledgeCards } from "./cards";
import {
  ATTEMPT_STATUSES,
  GRADED_BY,
  GRADES,
  QUIZ_GENERATED_BY,
  QUIZ_ITEM_TYPES,
  QUIZ_STATUSES,
} from "./enums";
import { people } from "./shop";
import { aiAuditLog } from "./system";
import { topics } from "./taxonomy";
import type { Threshold } from "./cards";

export interface RubricCriterion {
  id: string;
  cardId: string;
  kind: "condition" | "action" | "exception" | "threshold" | "rationale";
  text: string;
  evidenceQuote: string;
  points: number;
  numeric?: Threshold;
}

export const quizzes = sqliteTable(
  "quizzes",
  {
    id: text("id").primaryKey(), // QZ-01
    title: text("title").notNull(),
    topicId: text("topic_id").references(() => topics.id),
    status: text("status", { enum: QUIZ_STATUSES }).notNull(),
    generatedBy: text("generated_by", { enum: QUIZ_GENERATED_BY }).notNull(),
    approvedByPersonId: text("approved_by_person_id").references(() => people.id),
    createdAt: text("created_at").notNull(),
    ...classificationColumns(),
  },
  (t) => [classificationCheck("quizzes", t.classification)],
);

export const quizQuestions = sqliteTable(
  "quiz_questions",
  {
    id: text("id").primaryKey(), // QZ-01-Q01
    quizId: text("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    itemType: text("item_type", { enum: QUIZ_ITEM_TYPES }).notNull(),
    prompt: text("prompt").notNull(),
    scenario: text("scenario", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    choices: text("choices", { mode: "json" }).$type<{ id: string; text: string }[]>(),
    answerKey: text("answer_key", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
    rubric: text("rubric", { mode: "json" }).$type<RubricCriterion[]>().notNull(),
    primaryCardId: text("primary_card_id")
      .notNull()
      .references(() => knowledgeCards.id),
    ...classificationColumns(),
  },
  (t) => [classificationCheck("quiz_questions", t.classification)],
);

export const quizQuestionCards = sqliteTable(
  "quiz_question_cards",
  {
    questionId: text("question_id")
      .notNull()
      .references(() => quizQuestions.id, { onDelete: "cascade" }),
    cardId: text("card_id")
      .notNull()
      .references(() => knowledgeCards.id),
    cardVersion: integer("card_version").notNull(),
  },
  (t) => [primaryKey({ columns: [t.questionId, t.cardId] })],
);

export const quizAttempts = sqliteTable("quiz_attempts", {
  id: text("id").primaryKey(), // QA-001
  quizId: text("quiz_id")
    .notNull()
    .references(() => quizzes.id),
  personId: text("person_id")
    .notNull()
    .references(() => people.id),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  scorePct: real("score_pct"),
  status: text("status", { enum: ATTEMPT_STATUSES }).notNull(),
  servedFrom: text("served_from", { enum: ["live", "demo_cache", "seed"] }).notNull(),
});

export const quizAnswers = sqliteTable("quiz_answers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  attemptId: text("attempt_id")
    .notNull()
    .references(() => quizAttempts.id, { onDelete: "cascade" }),
  questionId: text("question_id")
    .notNull()
    .references(() => quizQuestions.id),
  response: text("response", { mode: "json" }).$type<unknown>().notNull(),
  grade: text("grade", { enum: GRADES }).notNull(),
  criteriaResults: text("criteria_results", { mode: "json" }).$type<unknown>(),
  feedbackMd: text("feedback_md"),
  gradedBy: text("graded_by", { enum: GRADED_BY }).notNull(),
  auditId: integer("audit_id").references(() => aiAuditLog.id),
});

export const trainingProgress = sqliteTable(
  "training_progress",
  {
    personId: text("person_id")
      .notNull()
      .references(() => people.id),
    cardId: text("card_id")
      .notNull()
      .references(() => knowledgeCards.id),
    correctScenarios: integer("correct_scenarios").notNull().default(0),
    boundaryCorrect: integer("boundary_correct", { mode: "boolean" }).notNull().default(false),
    masteredAt: text("mastered_at"),
    lastAttemptAt: text("last_attempt_at"),
    invalidatedAt: text("invalidated_at"),
  },
  (t) => [primaryKey({ columns: [t.personId, t.cardId] })],
);
