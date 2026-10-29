/**
 * The Messages API request and stream handling shared by the Anthropic and Bedrock adapters (same request and stream
 * types). Rules (CLAUDE.md "AI adapter rules"): never temperature / top_p / top_k, never a forced tool_choice, never an
 * assistant prefill, never `thinking` (adaptive thinking stays the model's default; max_tokens leaves headroom), effort
 * only via output_config.effort, structured output only via a hand-written schema (first-party API) — and no server-side
 * refusal fallbacks of any kind (docs/AI-GATEWAY.md §17).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import { AIError } from "@/lib/ai/errors";
import type {
  CallOptions,
  ProviderRequest,
  ProviderResponse,
  ProviderStopReason,
  ProviderStreamEvent,
} from "@/lib/ai/types";
import { mapProviderError } from "./errors";

type MessagesParams = Anthropic.MessageCreateParamsNonStreaming;

/** Anthropic and the Bedrock clients both expose messages.stream with the same request and event types. */
export interface StreamingClient {
  messages: Pick<Anthropic["messages"], "stream">;
}

/** Asserts the ProviderRequest invariants (non-empty, last message from the user: no prefill). */
export function assertSendable(req: ProviderRequest): void {
  if (req.messages.length === 0 || req.messages[req.messages.length - 1].role !== "user") throw new AIError("invalid_request");
  if (!Number.isInteger(req.maxTokens) || req.maxTokens <= 0) throw new AIError("invalid_request");
}

export function toMessagesParams(req: ProviderRequest, model: string, opts: { nativeJson: boolean }): MessagesParams {
  assertSendable(req);
  const params: MessagesParams = {
    model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
  };
  const outputConfig: Anthropic.OutputConfig = {};
  if (req.effort) outputConfig.effort = req.effort;
  if (opts.nativeJson && req.output.kind === "json") {
    // Hand-written schema, untransformed (the SDK's zod helper drops enums). The parse helper is not sent: the gateway
    // parses and validates the JSON itself.
    const { type, schema } = jsonSchemaOutputFormat(req.output.jsonSchema as { type: "object" }, { transform: false });
    outputConfig.format = { type, schema };
  }
  if (Object.keys(outputConfig).length > 0) params.output_config = outputConfig;
  return params;
}

function stopReasonOf(raw: string | null | undefined): ProviderStopReason {
  return raw === "end_turn" || raw === "max_tokens" || raw === "refusal" || raw === "stop_sequence" ? raw : "other";
}

/** Streams one Messages API call (Anthropic or Bedrock client) as ProviderStreamEvents. */
export async function* streamMessages(
  client: StreamingClient,
  params: MessagesParams,
  o: CallOptions,
): AsyncGenerator<ProviderStreamEvent> {
  const started = performance.now();
  let ttft: number | null = null;
  try {
    const stream = client.messages.stream(params, { signal: o.signal, timeout: o.timeoutMs });
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
        if (ttft === null) ttft = performance.now() - started;
        yield { type: "text", text: ev.delta.text };
      }
    }
    const msg = await stream.finalMessage();
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const details = (msg as { stop_details?: { category?: string | null } | null }).stop_details;
    const response: ProviderResponse = {
      text,
      stopReason: stopReasonOf(msg.stop_reason),
      rawStopReason: msg.stop_reason ?? null,
      refusalCategory: msg.stop_reason === "refusal" ? (details?.category ?? null) : null,
      servedModel: typeof msg.model === "string" ? msg.model : null,
      usage: { inputTokens: msg.usage?.input_tokens ?? null, outputTokens: msg.usage?.output_tokens ?? null },
      timings: { latencyMs: performance.now() - started, ttftMs: ttft },
    };
    yield { type: "done", response };
  } catch (err) {
    throw mapProviderError(err, o.signal);
  }
}

/** Drains a provider stream into its final response. */
export async function drain(events: AsyncIterable<ProviderStreamEvent>): Promise<ProviderResponse> {
  for await (const ev of events) if (ev.type === "done") return ev.response;
  throw new AIError("provider_error");
}
