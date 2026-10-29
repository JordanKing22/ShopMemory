/**
 * ProviderDescriptor from a routing target (docs/AI-GATEWAY.md §8). Pure: the descriptor copies the exact base URL and
 * host the routing summary built (src/lib/policy/summary.ts routingTargetFor), so the host shown in the header, checked
 * by the policy, written to the audit and called by the adapter is always the same value.
 */
import type { RoutingTarget } from "@/lib/policy/summary";
import type { ProviderDescriptor, ProviderVerification } from "./types";

export interface Availability {
  available: boolean;
  verified: ProviderVerification;
  unavailableReason?: string;
}

export function descriptorFor(target: RoutingTarget, a: Availability): ProviderDescriptor {
  const d: ProviderDescriptor = {
    kind: target.providerKind,
    targetClass: target.targetClass,
    isCloud: target.isCloud,
    model: target.model,
    baseUrl: target.baseUrl,
    host: target.host,
    coveredModel: target.coveredModel,
    isLoopback: target.isLoopback,
    available: a.available && target.configured,
    verified: a.verified,
  };
  if (target.region !== undefined) d.region = target.region;
  if (target.endpointMode !== undefined) d.endpointMode = target.endpointMode;
  if (target.fips !== undefined) d.fips = target.fips;
  if (target.crossRegion !== undefined) d.crossRegion = target.crossRegion;
  if (target.locality !== undefined) d.locality = target.locality;
  if (target.govCloud !== undefined) d.govCloud = target.govCloud;
  if (!d.available && a.unavailableReason) d.unavailableReason = a.unavailableReason;
  return d;
}
