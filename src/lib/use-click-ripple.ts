import { useEffect, useRef } from "react";

// Pointer-driven holographic ripple on any clickable element. Mounts a layer
// listener that injects a brief animated circle at the click coordinates.
export function useClickRipple() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const root = ref.current ?? document.body;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const interactive = target.closest("button, a, [role=button], [data-ripple]");
      if (!interactive) return;
      const rect = (interactive as HTMLElement).getBoundingClientRect();
      const span = document.createElement("span");
      span.className = "click-ripple";
      const size = Math.max(rect.width, rect.height);
      span.style.width = span.style.height = `${size}px`;
      span.style.left = `${e.clientX - rect.left - size / 2}px`;
      span.style.top = `${e.clientY - rect.top - size / 2}px`;
      const prev = (interactive as HTMLElement).style.position;
      if (!prev || prev === "static") (interactive as HTMLElement).style.position = "relative";
      (interactive as HTMLElement).style.overflow = "hidden";
      interactive.appendChild(span);
      setTimeout(() => span.remove(), 650);
    };
    root.addEventListener("click", onClick);
    return () => root.removeEventListener("click", onClick);
  }, []);
  return ref;
}
