export type Role = 'REPORTER' | 'TECHNICIAN' | 'COORDINATOR' | 'ADMIN';
export type Status =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'DELAYED'
  | 'COMPLETED'
  | 'CLOSED';
export type Urgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface TradeUnit {
  id: string;
  name: string;
}

export interface Category {
  id: string;
  name: string;
  defaultTradeUnit: TradeUnit;
}

export interface Location {
  id: string;
  building: string;
  floor: string;
  room: string;
}

export interface Photo {
  id: string;
  storageUrl: string;
}

export interface StatusLog {
  id: string;
  oldStatus: Status | null;
  newStatus: Status;
  remarks: string | null;
  photoUrl: string | null;
  createdAt: string;
}

export interface Technician {
  id: string;
  fullName: string;
  tradeUnit: TradeUnit | null;
}

export interface JobOrderBasic {
  id: string;
  jobOrderNo: string;
  reportId: string;
  tradeUnitId: string;
  technicianId: string | null;
  materialsNote: string | null;
  targetDate: string | null;
  status: Status;
  createdAt: string;
}

export interface Reporter {
  id: string;
  fullName: string;
  userType: string | null;
}

export interface Report {
  id: string;
  description: string;
  urgency: Urgency;
  status: Status;
  createdAt: string;
  category: { id: string; name: string };
  location: Location;
  proposedTradeUnit: TradeUnit;
  photos: Photo[];
  reporter: Reporter;
  jobOrder: JobOrderBasic | null;
  logs: StatusLog[];
}

export interface MaterialDelay {
  id: string;
  reason: string;
  materialsNote: string | null;
  revisedTargetDate: string | null;
  previousStatus: Status;
  createdAt: string;
  resolvedAt: string | null;
  reportedBy: { id: string; fullName: string };
}

export interface JobOrder extends JobOrderBasic {
  tradeUnit: TradeUnit;
  technician: { id: string; fullName: string } | null;
  delays: MaterialDelay[];
  report: {
    id: string;
    description: string;
    urgency: Urgency;
    status: Status;
    category: { id: string; name: string };
    location: Location;
    reporter: Reporter;
  };
}

export interface ReportOptions {
  categories: Category[];
  locations: Location[];
  urgencies: Urgency[];
}

export interface Feedback {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
}

export interface ManagedUser {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  userType: string | null;
  isActive: boolean;
  tradeUnit: TradeUnit | null;
}

export interface CountItem {
  label: string;
  count: number;
}

export interface TimePoint {
  date: string; // YYYY-MM-DD (Manila time; Monday for weekly buckets)
  count: number;
}

export interface TechnicianStats {
  assigned: number;
  active: number;
  delayed: number;
  finished: number;
  avgCompletionHours: number | null;
  onTimeRate: number | null;
  onTimeSample: number;
  avgRating: number | null;
  ratingCount: number;
  reworkCount: number;
  firstTimeApprovalRate: number | null;
}

export interface TechnicianRow extends TechnicianStats {
  technicianId: string;
  name: string;
}

export interface AnalyticsOverview {
  rangeDays: number | null;
  unit: 'day' | 'week';
  summary: {
    total: number;
    awaitingAction: number;
    finished: number;
    avgResolutionHours: number | null;
    overdueJobs: number;
    avgRating: number | null;
    ratingCount: number;
  };
  reportsOverTime: TimePoint[];
  resolvedOverTime: TimePoint[];
  byStatus: CountItem[];
  byUrgency: CountItem[];
  byCategory: CountItem[];
  byTradeUnit: CountItem[];
  byBuilding: CountItem[];
  topLocations: CountItem[];
  byWeekday: CountItem[];
  byHour: CountItem[];
  technicians: TechnicianRow[];
}