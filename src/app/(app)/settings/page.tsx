import type { Metadata } from "next";
import Link from "next/link";
import { ClearanceDots } from "@/components/app/provider-badge";
import { PageHeader } from "@/components/app/page-header";
import { ReplayTag } from "@/components/app/replay-tag";
import { HealthPanel } from "@/components/settings/health-panel";
import { RoutingForm } from "@/components/settings/routing-form";
import { TestPrompt } from "@/components/settings/test-prompt";
import { formatProviderLine } from "@/lib/format";
import { COVERED_MODEL_TEXT, CROSS_REGION_TEXT, modeSentence } from "@/lib/routing-copy";
import { getSettingsPage, type ProviderDetailVM } from "@/server/queries/settings";

export const metadata: Metadata = { title: "Settings" };

const SOURCE_TEXT = {
  setting: "Set here in Settings (Reset demo clears it).",
  env: "From the server configuration (LLM_PROVIDER, AI_MODE).",
  locked_env: "Locked by the server configuration (AI_SETTINGS_LOCKED=true).",
} as const;

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="rounded-lg border bg-card p-4 text-card-foreground shadow-xs sm:p-5">
      <h2 id={id} className="mb-3 text-lg font-semibold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="min-w-0 break-words text-ink">{children}</dd>
    </div>
  );
}

function ProviderCard({ p }: { p: ProviderDetailVM }) {
  return (
    <div className="rounded-md border p-3" data-provider={p.kind}>
      <p className="mb-2 font-semibold text-ink">
        {p.label} <span className="font-normal text-muted-foreground">· {p.configured ? "configured" : "not configured"}</span>
      </p>
      <dl className="space-y-1 text-sm">
        <Fact term="Model">{p.model || "not set"}</Fact>
        <Fact term="Host">{p.host || "not set"}</Fact>
        {p.region ? <Fact term="Region">{p.region}</Fact> : null}
        {p.kind === "bedrock" && p.crossRegion ? <Fact term="Cross-region">{CROSS_REGION_TEXT[p.crossRegion as keyof typeof CROSS_REGION_TEXT] ?? p.crossRegion}</Fact> : null}
        {p.kind === "bedrock" ? <Fact term="FIPS endpoint">{p.fips ? "Yes" : "No"}</Fact> : null}
        {p.kind === "bedrock" && p.govCloud ? (
          <Fact term="GovCloud">{p.govCloud.qualified ? "Allowlisted GovCloud endpoint" : `Treated as commercial (${p.govCloud.failed.length} check${p.govCloud.failed.length === 1 ? "" : "s"} not met)`}</Fact>
        ) : null}
        {p.kind === "anthropic" ? <Fact term="API key">{p.keyPresent ? "set" : "not set"}</Fact> : null}
        {p.kind === "anthropic" ? <Fact term="Workspace ID">{p.workspaceIdSet ? "set" : "not set"}</Fact> : null}
        {p.kind === "ollama" ? <Fact term="Where">{p.isLoopback ? "this computer" : p.locality === "not_local" ? "not local (refused)" : "on-prem host"}</Fact> : null}
        {p.coveredModel ? <Fact term="Retention">{COVERED_MODEL_TEXT}</Fact> : null}
      </dl>
      {p.problems.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-ink">
          {p.problems.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * Settings (PLAN.md §4.11, §9): AI mode and cloud provider, provider details (presence of credentials only, never
 * values), "Send test prompt" through the real gateway, provider checks and the local-model warm-up.
 */
export default async function SettingsPage() {
  const vm = await getSettingsPage();
  const s = vm.summary;
  return (
    <div className="mx-auto flex min-w-0 max-w-5xl flex-col gap-5">
      <PageHeader
        className="mb-0"
        title="Settings"
        description="Where AI requests go, and a test that runs one request through the same gateway, policy, redaction and audit log as every feature."
      />

      <Section title="AI routing" id="routing">
        <div className="mb-4 space-y-2">
          <p className="text-ink">
            <span className="font-semibold">Now: {s.mode === "cloud" ? "Cloud" : s.mode === "local" ? "Local" : "Hybrid"} · {formatProviderLine(s.primary)}</span>
          </p>
          <p className="text-muted-foreground">{modeSentence(s)}</p>
          <p className="text-sm text-muted-foreground">{SOURCE_TEXT[vm.effective.source]}</p>
          <ClearanceDots summary={s} />
          {vm.demo.demoMode ? (
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <ReplayTag />
              <span className="text-ink">
                Demo mode: answers are replayed from recordings ({vm.demo.demoMiss === "live" ? "a miss calls the provider live" : "a miss shows a scripted offline answer"}). The policy, redaction and audit log run exactly as for a live call.
              </span>
            </p>
          ) : null}
        </div>
        <RoutingForm effective={vm.effective} options={vm.options} canChange={vm.canChange} />
      </Section>

      <Section title="Send test prompt" id="test">
        <p className="mb-3 text-muted-foreground">
          Sends a one-line connectivity check that names you, so the audit row shows how names are replaced with tokens before a cloud call.{" "}
          <Link className="font-medium text-primary underline underline-offset-2" href="/audit">
            Open the audit log
          </Link>
        </p>
        <TestPrompt enabled={vm.canTest} reason={vm.canTest ? undefined : "Only the owner can send the test prompt in this demo."} />
      </Section>

      <Section title="Providers" id="providers">
        <div className="grid gap-3 md:grid-cols-3">
          {vm.providers.map((p) => (
            <ProviderCard key={p.kind} p={p} />
          ))}
        </div>
        {vm.sdkEnvOverrides.length > 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Set but ignored (every client gets an explicit base URL and key): {vm.sdkEnvOverrides.join(", ")}.
          </p>
        ) : null}
        <div className="mt-4">
          <HealthPanel enabled={vm.canTest} />
        </div>
      </Section>

      <Section title="Machine QR codes" id="qr">
        <p className="text-ink">
          QR labels open <span className="font-mono text-sm">{vm.publicBaseUrl}/machines/…</span> (PUBLIC_BASE_URL). Use the laptop&apos;s LAN address
          when a tablet will scan them.
        </p>
      </Section>
    </div>
  );
}
