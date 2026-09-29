import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, TriangleAlert } from "lucide-react";
import type { MachineLabelVM, MachineQrVM } from "@/lib/data/machines";
import { LABEL_CSS, LABEL_SHEET_PAGE_CSS, LabelSheet, MachineLabel, SINGLE_LABEL_PAGE_CSS } from "./machine-label";
import { PrintButton } from "./print-button";

/*
 * The two print routes' bodies (src/app/(print)/machines/…). Presentational only: the pages load the view models and
 * pass them in. Everything except the label(s) is screen-only (print:hidden), so the printed page is just labels.
 */

function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-tap w-fit items-center gap-2 rounded-md font-medium text-primary underline-offset-4 hover:underline"
    >
      <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
      {children}
    </Link>
  );
}

/** Warns when the codes point at this computer only (a phone or tablet can't open them). */
function LoopbackNote({ qr }: { qr: MachineQrVM }) {
  if (!qr.loopback) return null;
  return (
    <p className="flex items-start gap-2 rounded-md border border-signal-strong bg-signal-tint px-3 py-2 text-sm text-ink">
      <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-signal-strong" />
      <span>
        These codes point to this computer only, so a phone or tablet on the floor can&apos;t open them. Before printing
        labels for the machines, set <code className="font-mono">PUBLIC_BASE_URL</code> in <code className="font-mono">.env</code> to an
        address those devices can reach and restart the server.
      </span>
    </p>
  );
}

function Toolbar({
  back,
  title,
  children,
  printLabel,
}: {
  back: ReactNode;
  title: ReactNode;
  children: ReactNode;
  printLabel: string;
}) {
  return (
    <div className="mx-auto mb-6 flex w-full max-w-3xl flex-col gap-3 print:hidden">
      {back}
      <h1 className="text-2xl leading-tight font-semibold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
      <div className="flex flex-col gap-2 text-muted-foreground">{children}</div>
      <div>
        <PrintButton>{printLabel}</PrintButton>
      </div>
    </div>
  );
}

/** /machines/[id]/print: one 4 × 2 in label at actual size. */
export function LabelPrintView({ label }: { label: MachineLabelVM }) {
  return (
    <>
      <style>{LABEL_CSS + SINGLE_LABEL_PAGE_CSS}</style>
      <Toolbar
        back={<BackLink href={`/machines/${label.id}`}>Back to {label.name}</BackLink>}
        title={
          <>
            QR label: {label.assetTag} {label.name}
          </>
        }
        printLabel="Print label"
      >
        <p>
          One 4 × 2 in label at actual size. In the print dialog, choose your label printer and 4 × 2 in paper, set the
          scale to 100 % and leave the margins on Default.
        </p>
        <p className="break-all text-ink">
          The code opens <span className="font-mono">{label.qr.url}</span>
        </p>
        <LoopbackNote qr={label.qr} />
      </Toolbar>
      <div
        role="region"
        aria-label="Label preview at actual size"
        tabIndex={0}
        className="overflow-x-auto py-2 print:overflow-visible print:p-0"
      >
        <MachineLabel label={label} className="mx-auto shadow-md print:m-0 print:shadow-none" />
      </div>
    </>
  );
}

/** /machines/labels: every machine's label, 8-up on one US Letter sheet at actual size. */
export function LabelSheetView({ labels }: { labels: MachineLabelVM[] }) {
  const first = labels[0];
  return (
    <>
      <style>{LABEL_CSS + LABEL_SHEET_PAGE_CSS}</style>
      <Toolbar back={<BackLink href="/machines">Back to Machines</BackLink>} title="QR label sheet" printLabel="Print label sheet">
        <p>
          All {labels.length} machine labels on one US Letter sheet at actual size: two columns of 4 × 2 in labels, laid out
          for 10-per-sheet 4 × 2 in label stock (the bottom row stays blank). Set the scale to 100 % and leave the margins on
          Default.
        </p>
        {first ? <LoopbackNote qr={first.qr} /> : null}
      </Toolbar>
      <div
        role="region"
        aria-label="Label sheet preview at actual size (US Letter)"
        tabIndex={0}
        className="overflow-x-auto rounded-lg bg-surface-sunken p-4 print:overflow-visible print:rounded-none print:bg-transparent print:p-0"
      >
        <div className="fw-paper mx-auto shadow-md">
          <LabelSheet labels={labels} />
        </div>
      </div>
    </>
  );
}
