// Builds the environment for a child process: the parent's environment plus a few overrides (for example
// FLOORWISE_DB=e2e). This is how npm scripts set variables without `VAR=x cmd`, which cmd.exe can't run.
// It never reads or prints individual variables; import telemetry-off first so NEXT_TELEMETRY_DISABLED is inherited.
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { ...process.env, ...extra };
}
