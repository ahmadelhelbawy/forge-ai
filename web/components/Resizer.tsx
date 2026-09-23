"use client";

import { useRef } from "react";

/**
 * A vertical drag handle between two panes.
 *
 * Pointer drag resizes, the arrow keys nudge by 16px (so it is usable without a
 * mouse), and a double-click restores the default width. It reports widths, not
 * deltas, so the owner clamps once and the handle holds no layout state.
 */
export function Resizer({
  label,
  width,
  min,
  max,
  defaultWidth,
  side,
  onResize,
}: {
  label: string;
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  /** Which pane the handle resizes: dragging right grows a left pane and shrinks a right one. */
  side: "left" | "right";
  onResize: (width: number) => void;
}): React.JSX.Element {
  const start = useRef<{ x: number; width: number } | null>(null);
  const clamp = (w: number): number => Math.round(Math.min(max, Math.max(min, w)));

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} — drag, or use the arrow keys. Double-click to reset.`}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, width };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const delta = e.clientX - start.current.x;
        onResize(clamp(start.current.width + (side === "left" ? delta : -delta)));
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={() => onResize(defaultWidth)}
      onKeyDown={(e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const grow = (e.key === "ArrowRight") === (side === "left");
        onResize(clamp(width + (grow ? 16 : -16)));
      }}
      className="group relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none focus-visible:outline-none"
    >
      <div className="mx-auto h-full w-px bg-white/[0.06] transition-colors group-hover:bg-accent-400/60 group-focus-visible:bg-accent-400" />
    </div>
  );
}
