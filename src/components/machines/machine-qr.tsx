import type { MachineQrVM } from "@/lib/data/machines";
import { cn } from "@/lib/utils";

export interface MachineQrProps {
  qr: MachineQrVM;
  className?: string;
  /** Extra attributes for tests (e.g. data-testid="machine-qr"). */
  "data-testid"?: string;
}

/**
 * The machine's QR code as inline SVG, drawn from the module path the data layer built with the qrcode package
 * (server-side, deterministic). Black on white with the quiet zone included, so it scans from screen and paper.
 * Safe in Server and Client Components (no hooks, no data imports at runtime).
 */
export function MachineQr({ qr, className, "data-testid": testId }: MachineQrProps) {
  return (
    <svg
      role="img"
      aria-label={`QR code for ${qr.url}`}
      data-testid={testId}
      data-qr-url={qr.url}
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${qr.size} ${qr.size}`}
      shapeRendering="crispEdges"
      className={cn("block bg-white", className)}
    >
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={qr.path} fill="#000000" />
    </svg>
  );
}
