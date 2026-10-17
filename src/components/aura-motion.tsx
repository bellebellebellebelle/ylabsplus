import { useEffect, useRef } from "react";

type AuraState = "idle" | "listening" | "thinking" | "speaking";

/** Ambient motion follows the conversation state; it never captures input. */
export function AuraMotion({ state }: { state: AuraState }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let frame = 0;
    let time = 0;
    let previous = 0;
    let energy = 0;
    let colors: string[] = [];
    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      const styles = getComputedStyle(canvas);
      colors = ["--motion-warm", "--motion-light", "--motion-cool"].map((token) => styles.getPropertyValue(token).trim());
    };
    const render = (now: number) => {
      const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      const current = stateRef.current;
      const target = current === "idle" ? 0 : current === "thinking" ? 0.72 : 1;
      energy += (target - energy) * Math.min(delta * 3, 1);
      time += delta * (current === "speaking" ? 1.35 : current === "thinking" ? 0.8 : 0.5);
      context.clearRect(0, 0, width, height);
      if (energy > 0.005 && !media.matches) {
        const cx = width / 2;
        const cy = height / 2 + 14 * Math.max(width / 1376, height / 768);
        const radius = Math.max(width / 1376, height / 768) * 172.5;
        const reach = Math.hypot(width, height) * 0.65;
        context.globalCompositeOperation = "screen";
        // Continuous silk-like trajectories extend beyond every viewport edge.
        for (let strand = 0; strand < 32; strand++) {
          const angle = strand * Math.PI * 2 / 32 + time * (current === "thinking" ? 0.3 : 0.06);
          context.beginPath();
          for (let step = 0; step <= 64; step++) {
            const p = step / 64;
            const r = radius * 0.8 + p * reach;
            const bend = Math.sin(p * 5 - time * 1.8 + strand * 0.4) * (0.11 + p * 0.3);
            const a = angle + bend + Math.sin(time + strand) * 0.04;
            const x = cx + Math.cos(a) * r;
            const y = cy + Math.sin(a) * r * (0.85 + 0.1 * Math.sin(time * 0.5));
            if (step === 0) context.moveTo(x, y); else context.lineTo(x, y);
          }
          context.strokeStyle = colors[strand % 3]!;
          context.globalAlpha = energy * (0.09 + 0.13 * (0.5 + 0.5 * Math.sin(time * 2 + strand)));
          context.lineWidth = strand % 4 === 0 ? 1.8 : 0.7;
          context.stroke();
        }
        // Expanding signal contours originate at the existing sphere.
        for (let ring = 0; ring < 5; ring++) {
          const p = ((time * (current === "speaking" ? 0.32 : 0.19) + ring / 5) % 1);
          const r = radius + p * reach;
          context.beginPath();
          for (let i = 0; i <= 160; i++) {
            const a = i / 160 * Math.PI * 2;
            const ripple = Math.sin(a * 6 + time * 3 + ring) * 8 * energy + Math.sin(a * 3 - time * 2) * 12;
            const x = cx + Math.cos(a) * (r + ripple);
            const y = cy + Math.sin(a) * (r + ripple);
            if (i === 0) context.moveTo(x, y); else context.lineTo(x, y);
          }
          context.closePath();
          context.strokeStyle = colors[ring % 3]!;
          context.globalAlpha = (1 - p) ** 2 * energy * 0.32;
          context.lineWidth = 1;
          context.stroke();
        }
        context.globalAlpha = 1;
        context.globalCompositeOperation = "source-over";
      }
      frame = requestAnimationFrame(render);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    frame = requestAnimationFrame(render);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); };
  }, []);

  return (
    <div className="aura-motion" data-state={state} aria-hidden="true">
      <canvas ref={canvasRef} className="aura-motion-canvas" />
      <div className="aura-edge-light" />
    </div>
  );
}