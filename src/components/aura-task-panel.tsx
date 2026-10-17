import { useEffect, useRef, useState } from 'react';
import { Grip, Move, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AURA_LAYOUT_KEY, fitPanel, readPanelLayout, type PanelLayout } from '@/lib/aura-layout';

export type BoardItem = { kind: 'step'; text: string } | { kind: 'result'; title: string; lines: string[] };

export function AuraTaskPanel({ items, onClose }: { items: BoardItem[]; onClose: () => void }) {
  const [layout, setLayout] = useState<PanelLayout | null>(null);
  const current = useRef(layout);
  const gesture = useRef<{ mode: 'move' | 'resize'; x: number; y: number; start: PanelLayout } | null>(null);
  useEffect(() => { current.current = layout; }, [layout]);
  useEffect(() => {
    const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });
    let saved: PanelLayout | null = null;
    try { saved = readPanelLayout(localStorage.getItem(AURA_LAYOUT_KEY)); } catch { /* Storage may be unavailable. */ }
    setLayout(fitPanel(saved ?? { x: window.innerWidth - 380, y: 80, width: 350, height: 420 }, viewport()));
    const resize = () => setLayout(value => value ? fitPanel(value, viewport()) : value);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  function start(event: React.PointerEvent, mode: 'move' | 'resize') {
    if (!layout || (event.target as HTMLElement).closest('button') && mode === 'move') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { mode, x: event.clientX, y: event.clientY, start: layout };
  }
  function move(event: React.PointerEvent) {
    const active = gesture.current;
    if (!active) return;
    const dx = event.clientX - active.x, dy = event.clientY - active.y;
    const next = fitPanel(active.mode === 'move' ? { ...active.start, x: active.start.x + dx, y: active.start.y + dy } : { ...active.start, width: active.start.width + dx, height: active.start.height + dy }, { width: window.innerWidth, height: window.innerHeight });
    current.current = next;
    setLayout(next);
  }
  function finish() {
    gesture.current = null;
    try { if (current.current) localStorage.setItem(AURA_LAYOUT_KEY, JSON.stringify(current.current)); } catch { /* Keep working without persistence. */ }
  }
  if (!layout) return null;
  return <aside aria-label="Messages d’Aura" className="aura-task-panel" style={{ left: layout.x, top: layout.y, width: layout.width, height: layout.height }}>
    <header className="aura-task-handle" onPointerDown={event => start(event, 'move')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}>
      <Move size={14}/><strong>Aura</strong><Button variant="ghost" size="icon" aria-label="Fermer le tableau" onClick={onClose}><X/></Button>
    </header>
    <div className="aura-task-content" aria-live="polite">{items.map((item, i) => item.kind === 'step' ? <p key={i} className="aura-task-step">{item.text}</p> : <section key={i}><h3>{item.title}</h3>{item.lines.map((line, j) => <p key={j}>{line}</p>)}</section>)}</div>
    <div role="slider" tabIndex={0} aria-label="Redimensionner les messages" aria-valuenow={Math.round(layout.width)} aria-valuemin={260} aria-valuemax={window.innerWidth - 24} className="aura-task-resize" onPointerDown={event => start(event, 'resize')} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onKeyDown={event => {
      const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 20 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -20 : 0;
      if (!delta) return;
      event.preventDefault();
      const next = fitPanel({ ...layout, width: layout.width + delta, height: layout.height + delta }, { width: window.innerWidth, height: window.innerHeight });
      setLayout(next); current.current = next; finish();
    }}><Grip size={16}/></div>
  </aside>;
}