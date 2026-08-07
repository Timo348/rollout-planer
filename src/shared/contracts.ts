export type UserSource = "oidc" | "dev" | "local";
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
  isPreparer: boolean;
  avatar?: UserAvatar;
  /** false = keine tägliche Termin-E-Mail; ein fehlender Wert bedeutet aktiviert. */
  agendaMailsEnabled?: boolean;
  /** Manueller Korrekturwert für die Terminstatistik (nur durch Admins änderbar). */
  statsAdjustment?: number;
}

export interface AssignmentStatsEntry {
  userId: string;
  displayName: string;
  username: string | null;
  /** Aus den Archivtabellen gezählte, tatsächlich durchgeführte Termine. */
  appointments: number;
  /** Manueller Korrekturwert. */
  adjustment: number;
  /** appointments + adjustment. */
  total: number;
}

export type AssignmentStatsPeriod = "14d" | "month" | "all";

export const CHANGE_NOTICE_MAX_WORDS = 125;

export interface ChangeNotice {
  id: string;
  content: string;
  publishedAt: string;
  publishedBy: string;
  publishedByName: string;
}

export interface ChangeNoticeLists {
  current: ChangeNotice[];
  general: ChangeNotice[];
}

export interface Appointment {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  name: string;
  assigneeId: string | null;
  isPrepared: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface AppointmentHistoryEntry {
  appointmentId: string;
  date: string;
  startTime: string;
  endTime: string;
  name: string;
  assigneeId: string | null;
  assigneeUsername: string | null;
  assigneeDisplayName: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  archivedAt: string;
  reason: string;
}

export interface ScheduleDates {
  today: string;
  nextWorkday: string;
  planningDays: string[];
}

export interface FixedSlot {
  startTime: string;
  endTime: string;
}

export interface AppPermissions {
  manageUsers: boolean;
}

export type PublicDashboardAppointmentScope = "all" | "today" | "today_tomorrow";
export type PublicDashboardTrendDays = 7 | 30;
export type PublicDashboardRefreshSeconds = 0 | 30 | 60 | 120;
export type PublicDashboardDefaultTheme = "light" | "dark";
export type PublicDashboardZoomPercent = 50 | 75 | 100 | 125 | 150 | 175 | 200 | 225 | 250;

export interface PublicDashboardSettings {
  id: string;
  name: string;
  slug: string;
  title: string;
  subtitle: string;
  isDefault: boolean;
  isEnabled: boolean;
  appointmentScope: PublicDashboardAppointmentScope;
  trendDays: PublicDashboardTrendDays;
  showAppointmentNames: boolean;
  showAssigneeNames: boolean;
  showQuickOverview: boolean;
  showPodium: boolean;
  showPreparationStatus: boolean;
  refreshSeconds: PublicDashboardRefreshSeconds;
  defaultTheme: PublicDashboardDefaultTheme;
  zoomPercent: PublicDashboardZoomPercent;
  createdAt: string;
  updatedAt: string;
}

export type CreatePublicDashboardInput = Omit<
  PublicDashboardSettings,
  "id" | "isDefault" | "createdAt" | "updatedAt"
>;

export type UpdatePublicDashboardInput = Omit<
  PublicDashboardSettings,
  "id" | "slug" | "createdAt" | "updatedAt"
>;

export interface PublicAppointment {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  name?: string;
  assigneeName?: string;
  isAssigned: boolean;
  isPrepared?: boolean;
}

export interface PublicDashboardTrendPoint {
  date: string;
  completed: number;
}

export interface PublicDashboardQuickOverview {
  todayPlanned: number;
  todayAssigned: number;
  todayUnassigned: number;
  todayPrepared: number;
  completedInTrend: number;
  tomorrowPlanned?: number;
}

export interface PublicDashboardPodiumEntry {
  rank: 1 | 2 | 3;
  avatarUrl?: string;
}

export interface PublicDashboardResponse {
  dashboard: Pick<
    PublicDashboardSettings,
    | "slug"
    | "title"
    | "subtitle"
    | "appointmentScope"
    | "trendDays"
    | "showQuickOverview"
    | "showPodium"
    | "showPreparationStatus"
    | "refreshSeconds"
    | "defaultTheme"
    | "zoomPercent"
  >;
  dates: ScheduleDates;
  visibleDates: string[];
  appointments: PublicAppointment[];
  trend: PublicDashboardTrendPoint[];
  quickOverview?: PublicDashboardQuickOverview;
  podium?: PublicDashboardPodiumEntry[];
  generatedAt: string;
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
  permissions: AppPermissions;
  hasUnreadChanges: boolean;
  guideUrl: string | null;
}

export interface SessionResponse {
  authenticated: boolean;
  user: AppUser | null;
  devLoginEnabled: boolean;
  oidcEnabled: boolean;
  adminLoginEnabled: boolean;
}

export interface ApiErrorBody {
  error: string;
  message: string;
  current?: Appointment;
  issues?: Array<{ path: string; message: string }>;
}
