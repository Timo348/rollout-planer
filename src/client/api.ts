import type {
  ApiErrorBody,
  Appointment,
  BootstrapResponse,
  SessionResponse,
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
  session: () => request<SessionResponse>("/api/session"),
  bootstrap: () => request<BootstrapResponse>("/api/bootstrap"),
  devLogin: () => request<{ user: BootstrapResponse["currentUser"] }>("/api/auth/dev-login", {
    method: "POST",
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
};
