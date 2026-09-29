import Link from "next/link";
import { Boxes, Briefcase, Building2, FileText, Layers, UserRound, Wrench, type LucideIcon } from "lucide-react";
import { ClassificationBadge } from "@/components/app/classification-badge";
import type { LinkKind } from "@/db/schema/enums";
import type { CardLinkVM } from "@/lib/data/cards";

const KIND_LABEL: Record<LinkKind, string> = {
  customer: "Customer",
  quote: "Quote",
  job: "Job",
  part: "Part",
  machine: "Machine",
  material: "Material",
  person: "Person",
};

const KIND_ICON: Record<LinkKind, LucideIcon> = {
  customer: Building2,
  quote: FileText,
  job: Briefcase,
  part: Boxes,
  machine: Wrench,
  material: Layers,
  person: UserRound,
};

function Inner({ link }: { link: CardLinkVM }) {
  const Icon = KIND_ICON[link.kind];
  return (
    <>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-muted-foreground">{KIND_LABEL[link.kind]}</span>
        <span className="block font-medium break-words text-ink">
          {link.label}
          {/* Customer names are fictional; some collide with real companies (CLAUDE.md hard rule 10). */}
          {link.kind === "customer" ? <span className="font-normal text-muted-foreground"> (fictional)</span> : null}
        </span>
        {link.detail ? <span className="block text-sm break-words text-muted-foreground">{link.detail}</span> : null}
        {link.mention ? <span className="mt-0.5 block text-sm text-ink italic">“{link.mention}”</span> : null}
        {link.classification ? (
          <span className="mt-1.5 block">
            <ClassificationBadge level={link.classification} size="sm" info={false} />
          </span>
        ) : null}
      </span>
    </>
  );
}

/** Linked records as tappable rows: people, jobs, quotes and machines link to their pages; the rest are labels. */
export function CardLinks({ links }: { links: CardLinkVM[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {links.map((l) => (
        <li key={`${l.kind}:${l.id}`} data-link-kind={l.kind}>
          {l.href ? (
            <Link
              href={l.href}
              className="flex min-h-tap items-start gap-3 rounded-md border bg-surface px-3 py-2 hover:border-primary"
            >
              <Inner link={l} />
            </Link>
          ) : (
            <div className="flex min-h-tap items-start gap-3 rounded-md border border-dashed bg-surface px-3 py-2">
              <Inner link={l} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
