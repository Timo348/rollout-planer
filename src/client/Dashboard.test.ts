import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { AppUser, Appointment } from "../shared/contracts";
import { AppointmentCard, ChangesDialog, ProfileMailPreferences, UserManagementDialog } from "./Dashboard";

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
    name: "Organisation A",
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

describe("Oberfläche für die Vorbereitungsrolle", () => {
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

  it("zeigt die Checkbox für die Vorbereitungsrolle in der Profilverwaltung", () => {
    const markup = renderToStaticMarkup(React.createElement(UserManagementDialog, {
      users: [user],
      currentUser: user,
      onClose: vi.fn(),
      onDelete: vi.fn(),
      onPreparerChange: vi.fn(),
    }));

    expect(markup).toContain("user-management__preparer is-active");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("Vorbereitungsrolle");
  });
});

describe("Änderungsmodul", () => {
  it("zeigt bei Administrationsberechtigung das Eingabefeld mit Wortlimit", () => {
    const markup = renderToStaticMarkup(React.createElement(ChangesDialog, {
      canDelete: true,
      onClose: vi.fn(),
      onViewed: vi.fn(),
    }));

    expect(markup).toContain("Änderung veröffentlichen");
    expect(markup).toContain("0/125 Wörter");
    expect(markup).toContain("Aktuelles");
    expect(markup).toContain("Allgemeines");
  });

  it("zeigt auch Personen ohne Administrationsberechtigung das Eingabefeld", () => {
    const markup = renderToStaticMarkup(React.createElement(ChangesDialog, {
      canDelete: false,
      onClose: vi.fn(),
      onViewed: vi.fn(),
    }));

    expect(markup).toContain("Änderung veröffentlichen");
    expect(markup).toContain("0/125 Wörter");
    expect(markup).toContain("Änderungen werden geladen");
  });
});

describe("E-Mail-Einstellungen im Profilmenü", () => {
  it("zeigt beide unabhängigen Einstellungen standardmäßig aktiviert", () => {
    const markup = renderToStaticMarkup(React.createElement(ProfileMailPreferences, {
      busy: false,
      onAgendaMailsChange: vi.fn(),
      onChangeNoticeMailsChange: vi.fn(),
    }));

    expect(markup).toContain("Tägliche Termin-E-Mail");
    expect(markup).toContain("E-Mail bei neuen Änderungen");
    expect(markup.match(/type="checkbox"/g)).toHaveLength(2);
    expect(markup.match(/checked=""/g)).toHaveLength(2);
  });

  it("bildet die Einstellungen getrennt voneinander ab", () => {
    const markup = renderToStaticMarkup(React.createElement(ProfileMailPreferences, {
      agendaMailsEnabled: true,
      changeNoticeMailsEnabled: false,
      busy: true,
      onAgendaMailsChange: vi.fn(),
      onChangeNoticeMailsChange: vi.fn(),
    }));

    expect(markup.match(/checked=""/g)).toHaveLength(1);
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });
});
