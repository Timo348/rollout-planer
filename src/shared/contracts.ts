export type UserSource = "oidc" | "dev";

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  source: UserSource;
  lastSeenAt: string;
}

export interface Appointment {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  name: string;
  assigneeId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ScheduleDates {
  today: string;
  nextWorkday: string;
}

export interface FixedSlot {
  startTime: string;
  endTime: string;
}

export interface BootstrapResponse {
  currentUser: AppUser;
  users: AppUser[];
  appointments: Appointment[];
  dates: ScheduleDates;
  fixedSlots: FixedSlot[];
  limits: {
    maxAppointmentsPerSlot: number;
  };
}

export interface SessionResponse {
  authenticated: boolean;
  user: AppUser | null;
  devLoginEnabled: boolean;
  oidcEnabled: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  current?: Appointment;
  issues?: Array<{ path: string; message: string }>;
}
