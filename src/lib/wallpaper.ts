/** Overlay strength (0–1) of the dark veil over a user wallpaper, so text stays readable.
 *  Brighter and busier images get a stronger veil. */
export function wallpaperVeil(luminance: number, contrast: number) {
  const l = Math.min(1, Math.max(0, luminance));
  const c = Math.min(1, Math.max(0, contrast));
  return Math.round(Math.min(0.88, 0.45 + l * 0.35 + c * 0.2) * 100) / 100;
}

/** Average luminance and contrast (std-dev) of an image, sampled on a tiny canvas. */
export function analyzeImage(img: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  canvas.width = 48; canvas.height = 48;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { luminance: 0.5, contrast: 0.5 };
  ctx.drawImage(img, 0, 0, 48, 48);
  const d = ctx.getImageData(0, 0, 48, 48).data;
  const values: number[] = [];
  for (let i = 0; i < d.length; i += 4) values.push((0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { luminance: mean, contrast: Math.min(1, sd * 2.5) };
}
