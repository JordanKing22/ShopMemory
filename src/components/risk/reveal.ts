/**
 * Keeps a keyboard-focused heat-map cell fully visible inside the table's horizontal scroller (WCAG 2.4.11 Focus Not
 * Obscured). The browser's own scroll-into-view on focus() ignores the sticky Topic column, so a cell reached with
 * the arrow keys could land underneath it. revealScrollLeft() is the pure geometry (unit-tested in
 * tests/data-risk.test.ts); revealCell() reads the DOM and applies it.
 */

/** Room the focus ring needs outside a cell: 2 px outline + 2 px offset (globals.css `:focus-visible`). */
export const FOCUS_RING_PX = 4;

export interface RevealGeometry {
  /** The scroller's current scrollLeft. */
  scrollLeft: number;
  /** The cell's left and right edges (viewport px). */
  cellLeft: number;
  cellRight: number;
  /** Right edge of the sticky Topic column in the cell's row (viewport px). */
  stickyRight: number;
  /** Right edge of the scroller's visible area, inside its border (viewport px). */
  viewRight: number;
}

/**
 * The scrollLeft that shows the whole cell and its focus ring between the sticky column and the scroller's right
 * edge, or null when the cell is already clear. The result is a whole pixel rounded away from the obscured side, so
 * device-pixel snapping can't leave the cell a fraction under the sticky column; a target within the focus-ring
 * margin of 0 snaps to 0.
 */
export function revealScrollLeft(g: RevealGeometry): number | null {
  const minLeft = g.stickyRight + FOCUS_RING_PX;
  const maxRight = g.viewRight - FOCUS_RING_PX;
  if (g.cellLeft < minLeft) {
    const target = Math.floor(g.scrollLeft - (minLeft - g.cellLeft));
    return target <= FOCUS_RING_PX ? 0 : target;
  }
  if (g.cellRight > maxRight) return Math.ceil(g.scrollLeft + (g.cellRight - maxRight));
  return null;
}

/**
 * True when the element shows the keyboard focus ring. A pointer click on a partly hidden cell must not scroll: the
 * cell would move out from under the pointer between mousedown and mouseup, and the click (which opens the sheet)
 * would land on another element. Browsers without `:focus-visible` get the reveal every time.
 */
export function hasKeyboardFocusRing(el: Element): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

/** Scrolls the cell's `[data-heat-scroll]` container so the cell clears its row's sticky header cell. Browser only. */
export function revealCell(el: HTMLElement): void {
  const scroller = el.closest<HTMLElement>("[data-heat-scroll]");
  const sticky = el.closest("tr")?.querySelector("th");
  if (!scroller || !sticky) return;
  const cell = el.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  const next = revealScrollLeft({
    scrollLeft: scroller.scrollLeft,
    cellLeft: cell.left,
    cellRight: cell.right,
    stickyRight: sticky.getBoundingClientRect().right,
    viewRight: view.left + scroller.clientLeft + scroller.clientWidth,
  });
  if (next !== null) scroller.scrollLeft = next;
}
