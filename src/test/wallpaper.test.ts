import { describe, it, expect } from "vitest";
import { wallpaperVeil } from "@/lib/wallpaper";

describe("wallpaperVeil", () => {
  it("bright busy images get a stronger veil than dark calm ones", () => {
    expect(wallpaperVeil(0.9, 0.8)).toBeGreaterThan(wallpaperVeil(0.1, 0.1));
  });
  it("never fully hides the wallpaper", () => {
    expect(wallpaperVeil(1, 1)).toBe(0.88);
  });
  it("dark calm images keep a minimum veil", () => {
    expect(wallpaperVeil(0, 0)).toBe(0.45);
  });
});
