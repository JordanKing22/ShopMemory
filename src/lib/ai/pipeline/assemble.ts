/**
 * P6 helpers (PLAN.md §4.2): per-request source keys S1…Sn (DB IDs never reach a provider), source fingerprints for
 * scenario replay, and the prompt-JSON instruction for providers without native structured output (Bedrock).
 */
import { canonicalJson, sha256Hex } from "@/lib/seed/source";
import { refKey, type JsonObject, type RecordRef } from "../types";

/** "card:KC-091@0123456789abcdef": the record plus a hash of exactly what was sent about it. */
export function sourceFingerprint(ref: RecordRef, projection: unknown): string {
  return `${refKey(ref)}@${sha256Hex(canonicalJson(projection)).slice(0, 16)}`;
}

export function sourceKey(index: number): string {
  return `S${index + 1}`;
}

/** Appended to the system prompt when the provider can't enforce a JSON schema itself. */
export function promptJsonInstruction(schema: JsonObject): string {
  return `\n\nRespond with only one JSON object that matches this JSON schema. No prose, no code fences.\n${JSON.stringify(schema)}`;
}

/** Stable hash of a request payload (P8). */
export function payloadHashOf(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Binds a preview to its payload AND destination: a Local → Cloud switch makes "Send exactly this" stale. */
export function previewTokenOf(payloadHash: string, targetClass: string, host: string, model: string): string {
  return sha256Hex(`${payloadHash}|${targetClass}|${host}|${model}`);
}
