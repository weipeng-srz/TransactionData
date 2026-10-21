"use client";

import { useLayoutEffect, useRef } from "react";

/** A retargetable spring: rapid switches preserve both position and velocity. */
export function useWorkspaceTabIndicator(value: string) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLDivElement>(null);
  const updateRef = useRef<((animate: boolean) => void) | null>(null);

  useLayoutEffect(() => {
    const track = trackRef.current;
    const indicator = indicatorRef.current;
    const scroller = scrollRef.current;
    if (!track || !indicator || !scroller) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let lastTime = 0;
    let initialized = false;
    let x = 0;
    let width = 0;
    let velocity = 0;
    let widthVelocity = 0;
    let targetX = 0;
    let targetWidth = 0;

    const paint = () => {
      indicator.style.transform = `translate3d(${x}px, 0, 0) scaleX(${width / targetWidth})`;
    };
    const settle = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      x = targetX;
      width = targetWidth;
      velocity = widthVelocity = 0;
      paint();
    };
    const step = (time: number) => {
      // Small integration steps keep the spring stable after a slow frame.
      const elapsed = Math.min((time - (lastTime || time - 16.67)) / 1000, 0.032);
      lastTime = time;
      const steps = Math.max(1, Math.ceil(elapsed / (1 / 120)));
      const dt = elapsed / steps;
      for (let i = 0; i < steps; i += 1) {
        velocity += ((targetX - x) * 420 - velocity * 34) * dt;
        widthVelocity += ((targetWidth - width) * 420 - widthVelocity * 34) * dt;
        x += velocity * dt;
        width += widthVelocity * dt;
      }
      paint();
      if (Math.abs(targetX - x) < 0.1 && Math.abs(targetWidth - width) < 0.1 && Math.abs(velocity) < 0.5 && Math.abs(widthVelocity) < 0.5) settle();
      else frame = requestAnimationFrame(step);
    };
    const update = (animate: boolean) => {
      const selected = track.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      if (!selected || !selected.offsetWidth) return; // A nested workspace can be hidden.
      const nextX = selected.offsetLeft;
      const nextWidth = selected.offsetWidth;
      const changed = targetX !== nextX || targetWidth !== nextWidth;
      targetX = nextX;
      targetWidth = nextWidth;
      indicator.style.width = `${targetWidth}px`;
      // A new base width must retain the visible width until the spring advances.
      paint();
      if (!initialized || !animate || motion.matches) settle();
      else if (changed && !frame) frame = requestAnimationFrame(step);
      initialized = true;
      track.dataset.indicatorReady = "true";

      // Reveal keyboard/deep-link selections without moving the page vertically.
      const padding = 6;
      const left = selected.offsetLeft - padding;
      const right = selected.offsetLeft + selected.offsetWidth + padding;
      if (left < scroller.scrollLeft || right > scroller.scrollLeft + scroller.clientWidth) {
        scroller.scrollTo({ left: left < scroller.scrollLeft ? left : right - scroller.clientWidth, behavior: animate && !motion.matches ? "smooth" : "instant" });
      }
    };
    updateRef.current = update;
    update(false);
    const resize = new ResizeObserver(() => update(false));
    resize.observe(track);
    track.querySelectorAll('[role="tab"]').forEach((tab) => resize.observe(tab));
    const onMotionChange = () => update(false);
    motion.addEventListener("change", onMotionChange);

    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      motion.removeEventListener("change", onMotionChange);
      updateRef.current = null;
      delete track.dataset.indicatorReady;
    };
  }, []);

  useLayoutEffect(() => { updateRef.current?.(true); }, [value]);
  return { scrollRef, trackRef, indicatorRef };
}
