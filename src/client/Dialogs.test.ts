import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { FixedSlot, ScheduleDates } from "../shared/contracts";
import { CreateDialog } from "./Dialogs";

Object.assign(globalThis, { React });

const dates: ScheduleDates = {
  today: "2026-07-30",
  nextWorkday: "2026-07-31",
  planningDays: ["2026-07-30", "2026-07-31"],
};

const fixedSlots: FixedSlot[] = [
  { startTime: "08:00", endTime: "09:00" },
  { startTime: "09:00", endTime: "10:00" },
];

function renderDialog(initialSlot: FixedSlot) {
  return renderToStaticMarkup(React.createElement(CreateDialog, {
    initialDate: dates.today,
    initialSlot,
    dates,
    fixedSlots,
    maximum: 50,
    onClose: vi.fn(),
    onCreate: vi.fn(),
  }));
}

describe("CreateDialog slot preselection", () => {
  it("selects a fixed slot passed by the schedule shortcut", () => {
    const markup = renderDialog(fixedSlots[1]!);

    expect(markup).toContain("slot-picker__item is-active");
    expect(markup).toContain("1 Termin wird erstellt");
  });

  it("prefills a custom slot passed by the schedule shortcut", () => {
    const markup = renderDialog({ startTime: "08:30", endTime: "09:15" });

    expect(markup).toContain("custom-time-toggle is-active");
    expect(markup).toContain('value="08:30"');
    expect(markup).toContain('value="09:15"');
    expect(markup).toContain("1 Termin wird erstellt");
  });
});
