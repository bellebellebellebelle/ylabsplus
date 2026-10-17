export type PanelLayout = { x: number; y: number; width: number; height: number };
export const AURA_LAYOUT_KEY = 'aura-task-layout';

export function fitPanel(layout: PanelLayout, viewport: { width: number; height: number }): PanelLayout {
  const width = Math.min(Math.max(260, layout.width), Math.max(0, viewport.width - 24));
  const height = Math.min(Math.max(180, layout.height), Math.max(0, viewport.height - 24));
  return { width, height, x: Math.max(12, Math.min(layout.x, viewport.width - width - 12)), y: Math.max(12, Math.min(layout.y, viewport.height - height - 12)) };
}

export function readPanelLayout(value: string | null): PanelLayout | null {
  try {
    const parsed: unknown = JSON.parse(value ?? 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    const data = parsed as Record<string, unknown>;
    if (['x', 'y', 'width', 'height'].every(key => typeof data[key] === 'number' && Number.isFinite(data[key]))) {
      return { x: Number(data['x']), y: Number(data['y']), width: Number(data['width']), height: Number(data['height']) };
    }
  } catch { /* Invalid stored preferences use defaults. */ }
  return null;
}