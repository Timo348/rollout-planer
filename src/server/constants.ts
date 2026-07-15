import type { FixedSlot } from "../shared/contracts.js";

export const FIXED_SLOTS: FixedSlot[] = [
  { startTime: "08:00", endTime: "09:00" },
  { startTime: "10:00", endTime: "11:00" },
  { startTime: "11:00", endTime: "12:00" },
  { startTime: "12:00", endTime: "13:00" },
];

export const MAX_APPOINTMENTS_PER_SLOT = 50;
