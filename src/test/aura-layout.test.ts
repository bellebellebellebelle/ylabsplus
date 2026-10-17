import { describe, expect, it } from 'vitest';
import { fitPanel, readPanelLayout } from '@/lib/aura-layout';

describe('Aura message preferences', () => {
  it('restores the exact saved position and size', () => {
    const preference = { x: 100, y: 90, width: 480, height: 300 };
    expect(readPanelLayout(JSON.stringify(preference))).toEqual(preference);
  });
  it('keeps saved messages reachable when the screen gets smaller', () => {
    expect(fitPanel({ x: 900, y: 800, width: 600, height: 600 }, { width: 390, height: 700 })).toEqual({ x: 12, y: 88, width: 366, height: 600 });
  });
  it('ignores invalid saved geometry', () => {
    expect(readPanelLayout('{"x":"invalid","y":0,"width":400,"height":300}')).toBeNull();
  });
});