/** The task registry. Phase 3 implements only "smoke"; any other task name is AIError("task_unknown"). */
import { smokeTask } from "./smoke";
import type { TaskDefinition, TaskRegistry } from "./types";

export const TASKS: TaskRegistry = {
  smoke: smokeTask as TaskDefinition,
};

export type { TaskDefinition, TaskRegistry, TaskContext, PromptSource, TaskOutput } from "./types";
