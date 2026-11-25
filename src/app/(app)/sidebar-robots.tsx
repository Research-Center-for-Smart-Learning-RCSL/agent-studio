"use client";

import { useEffect, useRef, useState } from "react";
import { DirectoryRobot } from "./directory-robot";

export function SidebarRobots() {
  const lane = useRef<HTMLDivElement>(null);
  const [greeting, setGreeting] = useState(false);

  useEffect(() => {
    if (!lane.current) return;
    const robots = Array.from(lane.current.querySelectorAll<HTMLElement>("[data-sidebar-robot]"));
    const [first, second] = robots.map((robot) => robot.querySelector("button"));
    if (!first || !second) return;

    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let met = false;
    let waveTimer: number | undefined;
    const patrol = window.setInterval(() => {
      if (document.hidden || motion.matches || second.offsetWidth === 0 || getComputedStyle(second).visibility !== "visible") return;
      const a = first.getBoundingClientRect();
      const b = second.getBoundingClientRect();
      const distance = Math.hypot(a.left - b.left, a.top - b.top);
      if (distance > 64) met = false;
      if (met || distance > 46 || robots.some((robot) => robot.dataset.pose !== "idle")) return;

      met = true;
      setGreeting(true);
      waveTimer = window.setTimeout(() => setGreeting(false), 1850);
    }, 80);

    return () => {
      window.clearInterval(patrol);
      window.clearTimeout(waveTimer);
    };
  }, []);

  return (
    <div className="studio-sidebar-mascot" ref={lane}>
      <DirectoryRobot size="compact" variant="sidebar" greeting={greeting} />
      <DirectoryRobot size="compact" variant="sidebar-buddy" greeting={greeting} />
    </div>
  );
}
