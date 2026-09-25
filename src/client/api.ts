import type {
  ApiErrorBody,
  AppointmentHistoryEntry,
  AppUser,
  Appointment,
  AssignmentStatsEntry,
  AssignmentStatsPeriod,
  BootstrapResponse,
  ChangeNotice,
  ChangeNoticeLists,
  CreatePublicDashboardInput,
  OldDeviceHostname,
  PublicDashboardResponse,
  PublicDashboardSettings,
  SessionResponse,
  UpdatePublicDashboardInput,
} from "../shared/contracts";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: ApiErrorBody,
  ) {
    super(message);
  }
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });

  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await response.json()) as unknown)
    : await response.text();

  if (!response.ok) {
    const errorBody =
      typeof body === "object" && body !== null
        ? (body as ApiErrorBody)
        : { error: "request_failed", message: String(body || "Anfrage fehlgeschlagen.") };
    throw new ApiError(errorBody.message, response.status, errorBody);
  }
  return body as T;
}

export const api = {
  publicDashboard: (slug?: string) =>
    request<PublicDashboardResponse>(
      slug
        ? `/api/public/dashboard/${encodeURIComponent(slug)}`
        : "/api/public/dashboard",
    ),
  session: () => request<SessionResponse>("/api/session"),
  bootstrap: () => request<BootstrapResponse>("/api/bootstrap"),
  devLogin: () => request<{ user: BootstrapResponse["currentUser"] }>("/api/auth/dev-login", {
    method: "POST",
  }),
  adminLogin: (username: string, password: string) =>
    request<{ user: BootstrapResponse["currentUser"] }>("/api/auth/admin-login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request<void>("/api/auth/logout", { method: "POST" }),
  createAppointments: (payload: {
    date: string;
    slots: Array<{ startTime: string; endTime: string; names: string[] }>;
  }) =>
    request<{ appointments: Appointment[] }>("/api/appointments/batch", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateAppointment: (
    id: string,
    payload: {
      version: number;
      name?: string;
      startTime?: string;
      endTime?: string;
      assigneeId?: string | null;
    },
  ) =>
    request<Appointment>(`/api/appointments/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    }),
  deleteAppointment: (id: string, version: number) =>
    request<void>(`/api/appointments/${encodeURIComponent(id)}?version=${version}`, {
      method: "DELETE",
    }),
  uploadAvatar: (file: File) =>
    request<{ user: AppUser }>("/api/users/me/avatar", {
      method: "PUT",
      body: file,
      headers: { "content-type": file.type },
    }),
  deleteAvatar: () =>
    request<{ user: AppUser }>("/api/users/me/avatar", { method: "DELETE" }),
  setUserPreparer: (id: string, isPreparer: boolean) =>
    request<{ user: AppUser }>(`/api/users/${encodeURIComponent(id)}/preparer`, {
      method: "PATCH",
      body: JSON.stringify({ isPreparer }),
    }),
  setAppointmentPrepared: (id: string, version: number, isPrepared: boolean) =>
    request<Appointment>(`/api/appointments/${encodeURIComponent(id)}/prepared`, {
      method: "PATCH",
      body: JSON.stringify({ version, isPrepared }),
    }),
  deleteUser: (id: string) =>
    request<void>(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" }),
  sendAgendaMails: () =>
    request<{ sent: number }>("/api/agenda/send", { method: "POST" }),
  getHistory: (date: string) =>
    request<{ entries: AppointmentHistoryEntry[] }>(`/api/history/${encodeURIComponent(date)}`),
  updatePreferences: (preferences: {
    agendaMailsEnabled?: boolean;
    changeNoticeMailsEnabled?: boolean;
  }) =>
    request<{ user: AppUser }>("/api/users/me/preferences", {
      method: "PUT",
      body: JSON.stringify(preferences),
    }),
  getAssignmentStats: (period: AssignmentStatsPeriod) =>
    request<{ entries: AssignmentStatsEntry[] }>(`/api/stats/assignments?period=${period}`),
  adjustAssignmentStats: (userId: string, delta: number) =>
    request<{ user: AppUser }>(`/api/stats/assignments/${encodeURIComponent(userId)}/adjust`, {
      method: "POST",
      body: JSON.stringify({ delta }),
    }),
  viewChanges: () =>
    request<ChangeNoticeLists>("/api/changes/view", { method: "POST" }),
  createChange: (content: string) =>
    request<{ notice: ChangeNotice }>("/api/changes", {
      method: "POST",
      body: JSON.stringify({ content }),
    }),
  deleteChange: (id: string) =>
    request<void>(`/api/changes/${encodeURIComponent(id)}`, { method: "DELETE" }),
  listHostnames: () =>
    request<{ hostnames: OldDeviceHostname[] }>("/api/hostnames"),
  createHostname: (hostname: string, name?: string) =>
    request<{ hostname: OldDeviceHostname }>("/api/hostnames", {
      method: "POST",
      body: JSON.stringify({ hostname, ...(name ? { name } : {}) }),
    }),
  setHostnameProcessed: (id: string, isProcessed: boolean) =>
    request<{ hostname: OldDeviceHostname }>(`/api/hostnames/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ isProcessed }),
    }),
  getPublicDashboards: () =>
    request<{ dashboards: PublicDashboardSettings[] }>("/api/admin/public-dashboards"),
  createPublicDashboard: (payload: CreatePublicDashboardInput) =>
    request<{ dashboard: PublicDashboardSettings }>("/api/admin/public-dashboards", {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updatePublicDashboard: (id: string, payload: UpdatePublicDashboardInput) =>
    request<{ dashboard: PublicDashboardSettings }>(
      `/api/admin/public-dashboards/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(payload) },
    ),
  deletePublicDashboard: (id: string) =>
    request<void>(`/api/admin/public-dashboards/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),
};
