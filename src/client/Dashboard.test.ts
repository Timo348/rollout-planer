import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppUser, Appointment } from "../shared/contracts";
import { AppointmentCard, UserManagementDialog } from "./Dashboard";

Object.assign(globalThis, { React });

const user: AppUser = {
  id: "oidc:alice",
  username: "alice",
  displayName: "Alice Beispiel",
  source: "oidc",
  lastSeenAt: "2026-07-30T08:00:00.000Z",
  isPreparer: true,
};

function appointment(isPrepared: boolean): Appointment {
  return {
    id: "appointment-1",
    date: "2026-07-30",
    startTime: "08:00",
    endTime: "09:00",
    name: "Kunde A",
    assigneeId: null,
    isPrepared,
    createdBy: user.id,
    createdAt: "2026-07-30T08:00:00.000Z",
    updatedAt: "2026-07-30T08:00:00.000Z",
    version: 1,
  };
}

function renderAppointment(isPrepared: boolean) {
  return renderToStaticMarkup(React.createElement(AppointmentCard, {
    appointment: appointment(isPrepared),
    users: [user],
    currentUser: user,
    busy: false,
    preparerMode: true,
    onAssign: vi.fn(),
    onPreparedChange: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
  }));
}

describe("Vorbereiter-Oberfläche", () => {
  it("zeigt offene Termine rot mit einer nicht gesetzten Vorbereitungskontrolle", () => {
    const markup = renderAppointment(false);

    expect(markup).toContain("is-preparation-pending");
    expect(markup).toContain("Vorbereitung offen");
    expect(markup).toContain('aria-pressed="false"');
  });

  it("zeigt vorbereitete Termine grün mit gesetztem Haken", () => {
    const markup = renderAppointment(true);

    expect(markup).toContain("is-prepared");
    expect(markup).toContain("Vorbereitet");
    expect(markup).toContain('aria-pressed="true"');
  });

  it("zeigt die Vorbereiter-Checkbox in der Benutzerverwaltung", () => {
    const markup = renderToStaticMarkup(React.createElement(UserManagementDialog, {
      users: [user],
      currentUser: user,
      onClose: vi.fn(),
      onDelete: vi.fn(),
      onPreparerChange: vi.fn(),
    }));

    expect(markup).toContain("user-management__preparer is-active");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("Vorbereiter");
  });
});
