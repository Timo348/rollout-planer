export type UserSource = "oidc" | "dev";
export type AvatarMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface UserAvatar {
  key: string;
  mimeType: AvatarMimeType;
  updatedAt: string;
}

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  email?: string;
  source: UserSource;
  lastSeenAt: string;
  avatar?: UserAvatar;
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
  planningDays: string[];
}

export interface EmployeeOfMonth {
  month: string;
  leaders: AppUser[];
  completedCount: number;
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
  employeeOfMonth: EmployeeOfMonth;
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
