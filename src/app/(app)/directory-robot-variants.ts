type Antenna = { offset: number; tip: string };
type RobotAppearance = { shell: string; trim: string; antennas: Antenna[] };

export const robotVariants = {
  directory: { shell: "#d1adb4", trim: "#9e7986", antennas: [{ offset: 0, tip: "#a7b8aa" }] },
  logs: {
    shell: "#acbdca", trim: "#748b9a",
    antennas: [{ offset: -1, tip: "#a3b2bf" }, { offset: 1, tip: "#a3b2bf" }],
  },
  admin: { shell: "#adb9a6", trim: "#788875", antennas: [{ offset: 0, tip: "#bba4ad" }] },
  editor: {
    shell: "#cdbba6", trim: "#99846f",
    antennas: [{ offset: -1, tip: "#bcb19c" }, { offset: 1, tip: "#bcb19c" }],
  },
  sidebar: { shell: "#bdb1c9", trim: "#887a99", antennas: [{ offset: 0, tip: "#aca4bd" }] },
} satisfies Record<string, RobotAppearance>;

export type RobotVariant = keyof typeof robotVariants;
