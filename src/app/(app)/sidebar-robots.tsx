"use client";

import { useEffect, useRef, useState } from "react";
import { DirectoryRobot } from "./directory-robot";

type Point = { x: number; y: number };
type Route = { start: Point; stop: Point };
const jumpMs = 560;
const turnMs = 520;
const waveMs = 1850;

function facing(from: Point, to: Point) {
  return Math.atan2(to.x - from.x, to.y - from.y);
}

function hop(from: Point, to: Point, elapsed: number, jumps: number): Point {
  const step = Math.min(jumps, elapsed / jumpMs);
  const landed = Math.floor(step);
  const flight = Math.max(0, Math.min(1, (step - landed - 0.18) / 0.64));
  const progress = (landed + flight) / jumps;
  return {
    x: from.x + (to.x - from.x) * progress,
    y: Math.max(0, from.y + (to.y - from.y) * progress - Math.sin(flight * Math.PI) * 9),
  };
}

function patrolRoutes(width: number, height: number, button: HTMLButtonElement, paired: boolean): Route[] {
  const x = Math.max(0, width - button.offsetWidth);
  const y = Math.max(0, height - button.offsetHeight);
  const ceiling = Math.min(10, y);
  if (!paired) return [{ start: { x: x / 2, y }, stop: { x: x / 2, y: ceiling } }];

  // On short viewports, leave room for the pair to meet side by side.
  const tall = y >= button.offsetHeight + 22;
  const separation = tall ? (button.offsetHeight + 22) / 2 : y / 2;
  return [
    { start: { x: x * 0.06, y }, stop: { x: x * (tall ? 0.29 : 0.14), y: y / 2 + separation } },
    { start: { x: x * 0.94, y: ceiling }, stop: { x: x * (tall ? 0.71 : 0.86), y: Math.max(ceiling, y / 2 - separation) } },
  ];
}

export function SidebarRobots({ drawerOpen }: { drawerOpen: boolean }) {
  const lane = useRef<HTMLDivElement>(null);
  const [pose, setPose] = useState({ greeting: false, angles: [0, 0] });

  useEffect(() => {
    const area = lane.current;
    if (!area) return;
    const buttons = Array.from(area.querySelectorAll("button"));
    const [first, buddy] = buttons;
    if (!first || !buddy) return;

    const desktop = window.matchMedia("(min-width: 861px)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let routes: Route[] = [];
    let jumps = 1;
    let elapsed = 0;
    let previous: number | undefined;
    let phase = "";
    let frame = 0;

    const measure = () => {
      const next = first.offsetWidth
        ? patrolRoutes(area.clientWidth, area.clientHeight, first, buddy.offsetWidth > 0)
        : [];
      if (routes.length !== next.length) elapsed = 0;
      routes = next;
      jumps = Math.max(1, ...routes.map(({ start, stop }) => Math.ceil(Math.hypot(stop.x - start.x, stop.y - start.y) / 46)));
      phase = "";
    };

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      const dt = previous === undefined ? 0 : Math.min(now - previous, 50);
      previous = now;
      if (document.hidden || (!desktop.matches && !drawerOpen) || !routes.length) return;
      if (reducedMotion.matches) {
        if (phase !== "reduced") {
          phase = "reduced";
          buttons.forEach((button) => button.style.removeProperty("--robot-position"));
          setPose({ greeting: false, angles: [0, 0] });
        }
        return;
      }

      const paired = routes.length === 2;
      const leg = jumps * jumpMs;
      const pause = paired ? 2 * turnMs + waveMs : turnMs;
      elapsed = (elapsed + dt) % (2 * leg + pause + turnMs);
      const returning = elapsed >= leg + pause;
      const greeting = paired && elapsed >= leg + turnMs && elapsed < leg + turnMs + waveMs;
      const meeting = paired && elapsed >= leg && elapsed < leg + turnMs + waveMs;
      const headingBack = elapsed >= leg + pause - turnMs && elapsed < 2 * leg + pause;
      const nextPhase = greeting ? "wave" : meeting ? "meet" : headingBack ? "back" : "out";

      if (phase !== nextPhase) {
        phase = nextPhase;
        setPose({
          greeting,
          angles: routes.map(({ start, stop }, index) => {
            if (meeting) return facing(stop, routes[1 - index].stop);
            return headingBack ? facing(stop, start) : facing(start, stop);
          }),
        });
      }
      routes.forEach(({ start, stop }, index) => {
        const position = returning
          ? hop(stop, start, elapsed - leg - pause, jumps)
          : hop(start, stop, elapsed, jumps);
        buttons[index].style.setProperty("--robot-position", `${position.x.toFixed(2)}px ${position.y.toFixed(2)}px`);
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    [area, ...buttons].forEach((element) => observer.observe(element));
    frame = requestAnimationFrame(tick);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [drawerOpen]);

  return (
    <div className="studio-sidebar-mascot" ref={lane}>
      <DirectoryRobot size="compact" variant="sidebar" greeting={pose.greeting} facing={pose.angles[0]} />
      <DirectoryRobot size="compact" variant="sidebar-buddy" greeting={pose.greeting} facing={pose.angles[1]} />
    </div>
  );
}
