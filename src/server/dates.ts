import type { ScheduleDates } from "../shared/contracts.js";

export const APP_TIME_ZONE = "Europe/Berlin";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function dateInTimeZone(now: Date = new Date(), timeZone = APP_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function isBadenWuerttembergHoliday(date: string): boolean {
  const year = Number(date.slice(0, 4));
  const fixed = new Set([
    `${year}-01-01`,
    `${year}-01-06`,
    `${year}-05-01`,
    `${year}-10-03`,
    `${year}-11-01`,
    `${year}-12-25`,
    `${year}-12-26`,
  ]);
  if (fixed.has(date)) return true;

  const easter = easterSunday(year);
  return [-2, 1, 39, 50, 60].some((offset) => addDays(easter, offset) === date);
}

export function isWorkday(date: string): boolean {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year!, month! - 1, day!)).getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isBadenWuerttembergHoliday(date);
}

export function nextWorkday(afterDate: string): string {
  let candidate = addDays(afterDate, 1);
  while (!isWorkday(candidate)) candidate = addDays(candidate, 1);
  return candidate;
}

export function scheduleDates(now: Date = new Date()): ScheduleDates {
  const today = dateInTimeZone(now);
  return { today, nextWorkday: nextWorkday(today) };
}
