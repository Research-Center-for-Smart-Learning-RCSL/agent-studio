"use client";

import { useEffect, useRef, useState } from "react";
import { DirectoryRobot } from "./directory-robot";

type Point = { x: number; y: number };
type Route = { start: Point; stop: Point; outboundBend: number; returnBend: number };
const jumpMs = 900;
const turnMs = 520;
const waveMs = 1850;
const patrolPatterns = [
  { centerX: 0.36, centerY: 0.43, bend: 0.8, soloTurn: 0.04 },
  { centerX: 0.64, centerY: 0.57, bend: 0.2, soloTurn: 0.19 },
  { centerX: 0.48, centerY: 0.49, bend: 0.56, soloTurn: 0.11 },
];

function facing(from: Point, to: Point) {
  return Math.atan2(to.x - from.x, to.y - from.y);
}

function normalHopsBeforeFlip() {
  return 2 + Math.floor(Math.random() * 6);
}

function hop(from: Point, to: Point, bend: number, elapsed: number, jumps: number, shouldFlip: boolean) {
  const step = Math.min(jumps, elapsed / jumpMs);
  const landed = Math.floor(step);
  const beat = step - landed;
  const takeoff = 0.15;
  const landing = 0.82;
  const flight = Math.max(0, Math.min(1, (beat - takeoff) / (landing - takeoff)));
  const travel = flight * flight * (3 - 2 * flight);
  const progress = (landed + travel) / jumps;
  const arc = Math.sin(Math.PI * flight) ** 1.3;
  const stride = Math.hypot(to.x - from.x, to.y - from.y) / jumps;
  const height = Math.min(16, 7 + stride * 0.2);
  const crouch = beat < takeoff ? Math.sin(Math.PI * beat / takeoff) : 0;
  const cushion = beat > landing ? Math.sin(Math.PI * (beat - landing) / (1 - landing)) : 0;
  const flipTime = shouldFlip ? Math.max(0, Math.min(1, (flight - 0.08) / 0.84)) : 0;
  const flipProgress = flipTime * flipTime * (3 - 2 * flipTime);
  const flipDirection = Math.sign(to.x - from.x) || Math.sign(to.y - from.y);
  const tuck = Math.sin(Math.PI * flipProgress);
  const stretch = arc * 0.045 - tuck * 0.15 - crouch * 0.095 - cushion * 0.125;
  const remaining = 1 - progress;
  return {
    x: remaining * remaining * from.x + 2 * remaining * progress * bend + progress * progress * to.x,
    y: Math.max(0, from.y + (to.y - from.y) * progress - arc * height),
    scaleX: 1 - stretch * 0.48,
    scaleY: 1 + stretch,
    flip: flipProgress === 1 ? 0 : flipProgress * 360 * flipDirection,
  };
}

function patrolRoutes(width: number, height: number, button: HTMLButtonElement, paired: boolean, pattern: typeof patrolPatterns[number]): Route[] {
  const x = Math.max(0, width - button.offsetWidth);
  const y = Math.max(0, height - button.offsetHeight);
  const ceiling = Math.min(10, y);
  if (!paired) {
    const center = x / 2;
    return [{
      start: { x: center, y },
      stop: { x: center, y: Math.max(ceiling, y * pattern.soloTurn) },
      outboundBend: center,
      returnBend: center,
    }];
  }

  const pairCeiling = ceiling + (y - ceiling) / 3;
  const pairSpan = y - pairCeiling;
  // On short viewports, leave room for the pair to meet side by side.
  const tall = pairSpan >= button.offsetHeight + 22;
  const separation = tall ? (button.offsetHeight + 22) / 2 : pairSpan / 2;
  const centerY = pairCeiling + Math.max(separation, Math.min(pairSpan - separation, pairSpan * pattern.centerY));
  return [
    {
      start: { x: x * 0.06, y },
      stop: { x: x * (tall ? pattern.centerX - 0.19 : 0.14), y: centerY + separation },
      outboundBend: x * (tall ? pattern.bend : 0.08),
      returnBend: x * (tall ? 1 - pattern.bend : 0.18),
    },
    {
      start: { x: x * 0.94, y: pairCeiling },
      stop: { x: x * (tall ? pattern.centerX + 0.19 : 0.86), y: centerY - separation },
      outboundBend: x * (tall ? 1 - pattern.bend : 0.92),
      returnBend: x * (tall ? pattern.bend : 0.82),
    },
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
    let patternIndex = 0;
    const tricks = buttons.map(() => ({ lastHop: 0, remaining: normalHopsBeforeFlip(), flip: false }));

    const resetHopKeys = () => {
      for (const trick of tricks) trick.lastHop = 0;
    };

    const measure = () => {
      const next = first.offsetWidth
        ? patrolRoutes(area.clientWidth, area.clientHeight, first, buddy.offsetWidth > 0, patrolPatterns[patternIndex])
        : [];
      if (routes.length !== next.length) {
        elapsed = 0;
        resetHopKeys();
      }
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
          for (const button of buttons) {
            button.style.removeProperty("--robot-position");
            button.style.removeProperty("--robot-hop-scale");
            button.style.removeProperty("--robot-flip");
          }
          setPose({ greeting: false, angles: [0, 0] });
        }
        return;
      }

      const paired = routes.length === 2;
      const leg = jumps * jumpMs;
      const pause = paired ? 2 * turnMs + waveMs : turnMs;
      elapsed += dt;
      const round = 2 * leg + pause + turnMs;
      if (elapsed >= round) {
        elapsed -= round;
        patternIndex = (patternIndex + 1) % patrolPatterns.length;
        resetHopKeys();
        measure();
        return;
      }
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
      const legElapsed = returning ? elapsed - leg - pause : elapsed;
      const moving = legElapsed < leg;
      // One decision per hop. The signed key distinguishes the outward and return legs.
      const hopKey = (Math.floor(legElapsed / jumpMs) + 1) * (returning ? -1 : 1);
      routes.forEach(({ start, stop, outboundBend, returnBend }, index) => {
        const trick = tricks[index];
        if (moving && trick.lastHop !== hopKey) {
          trick.lastHop = hopKey;
          trick.flip = trick.remaining === 0;
          trick.remaining = trick.flip ? normalHopsBeforeFlip() : trick.remaining - 1;
        }
        const position = returning
          ? hop(stop, start, returnBend, legElapsed, jumps, moving && trick.flip)
          : hop(start, stop, outboundBend, legElapsed, jumps, moving && trick.flip);
        buttons[index].style.setProperty("--robot-position", `${position.x.toFixed(2)}px ${position.y.toFixed(2)}px`);
        buttons[index].style.setProperty("--robot-hop-scale", `${position.scaleX.toFixed(3)} ${position.scaleY.toFixed(3)}`);
        buttons[index].style.setProperty("--robot-flip", `${position.flip.toFixed(2)}deg`);
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
