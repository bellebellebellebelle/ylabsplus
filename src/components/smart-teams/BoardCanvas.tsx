import { Button } from "@/components/ui/button";
import { useCallback, useRef, type ReactNode } from "react";
import { Minus, Plus, Crosshair } from "lucide-react";

export type View = { x: number; y: number; scale: number };

type Props = {
  view: View;
  onViewChange: (view: View) => void;
  onBackgroundClick?: () => void;
  onRecenter?: () => void;
  children: ReactNode;
};

const MIN = 0.35;
const MAX = 2.2;

export function BoardCanvas({
  view,
  onViewChange,
  onBackgroundClick,
  onRecenter,
  children,
}: Props) {
  const panning = useRef<{ id: number; startX: number; startY: number; ox: number; oy: number } | null>(
    null,
  );
  const moved = useRef(false);

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const scale = Math.min(MAX, Math.max(MIN, view.scale * factor));
      const k = scale / view.scale;
      onViewChange({
        scale,
        x: cx - (cx - view.x) * k,
        y: cy - (cy - view.y) * k,
      });
    },
    [view, onViewChange],
  );

  return (
    <div
      className="board-grid relative h-full w-full touch-none overflow-hidden"
      style={{
        backgroundSize: `${28 * view.scale}px ${28 * view.scale}px, ${28 * view.scale}px ${28 * view.scale}px`,
        backgroundPosition: `${view.x}px ${view.y}px, ${view.x + 14 * view.scale}px ${view.y + 14 * view.scale}px`,
      }}
      onWheel={(e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        zoomAt(
          Math.exp(-e.deltaY * 0.0015),
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
      }}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget && !(e.target as HTMLElement).dataset["pan"]) return;
        moved.current = false;
        panning.current = {
          id: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          ox: view.x,
          oy: view.y,
        };
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const p = panning.current;
        if (!p || p.id !== e.pointerId) return;
        const dx = e.clientX - p.startX;
        const dy = e.clientY - p.startY;
        if (Math.abs(dx) + Math.abs(dy) > 3) moved.current = true;
        onViewChange({ ...view, x: p.ox + dx, y: p.oy + dy });
      }}
      onPointerUp={(e) => {
        if (panning.current?.id === e.pointerId) {
          panning.current = null;
          if (!moved.current) onBackgroundClick?.();
        }
      }}
      onPointerCancel={() => {
        panning.current = null;
      }}
    >
      <div
        data-pan="1"
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
          width: 1,
          height: 1,
        }}
      >
        {children}
      </div>

      <div className="pointer-events-auto absolute bottom-4 right-4 flex items-center gap-1 rounded-full border border-border st-panel px-2 py-1.5">
        <Button variant="ghost"
          aria-label="Dézoomer"
          className="rounded-full p-1.5 hover:bg-secondary"
          onClick={() => zoomAt(0.85, 0, 0)}
        >
          <Minus className="size-4" />
        </Button>
        <span className="w-11 text-center text-xs font-semibold tabular-nums">
          {Math.round(view.scale * 100)}%
        </span>
        <Button variant="ghost"
          aria-label="Zoomer"
          className="rounded-full p-1.5 hover:bg-secondary"
          onClick={() => zoomAt(1.18, 0, 0)}
        >
          <Plus className="size-4" />
        </Button>
        <Button variant="ghost"
          aria-label="Recentrer le tableau"
          className="rounded-full p-1.5 hover:bg-secondary"
          onClick={onRecenter}
        >
          <Crosshair className="size-4" />
        </Button>
      </div>
    </div>
  );
}
