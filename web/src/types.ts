export type Role = 'REPORTER' | 'TECHNICIAN' | 'COORDINATOR' | 'ADMIN';
export type Status =
  | 'SUBMITTED'
  | 'UNDER_REVIEW'
  | 'ASSIGNED'
  | 'IN_PROGRESS'
  | 'DELAYED'
  | 'COMPLETED'
  | 'CLOSED'
  // job orders only: merged into another job order for the same problem
  | 'CANCELLED';
export type Urgency = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type PriorityLevel = 'P1' | 'P2' | 'P3' | 'P4';
export type FormStatus = 'SUBMITTED' | 'RECEIVED' | 'APPROVED' | 'RETURNED';

// a reporter's signed Job Order Form (signature only as a short-lived link)
export interface JobOrderFormView {
  id: string;
  formNo: string;
  reportId: string;
  revision: number;
  status: FormStatus;
  requesterName: string;
  requesterEmail: string;
  requesterType: string | null;
  department: string;
  contactNumber: string;
  workRequested: string;
  locationText: string;
  categoryName: string;
  urgency: Urgency;
  preferredSchedule: string | null;
  notes: string | null;
  signedAt: string;
  submittedAt: string;
  receivedAt: string | null;
  receivedBy: { id: string; fullName: string } | null;
  decidedAt: string | null;
  decidedBy: { id: string; fullName: string } | null;
  decisionNote: string | null;
  contentHash: string;
  signatureUrl: string | null;
  integrityOk: boolean;
  report: {
    id: string;
    status: Status;
    duplicateOfId: string | null;
    jobOrder: { id: string; jobOrderNo: string; status: Status } | null;
  } | null;
}
export type ReviewFlagCode =
  | 'impact_missing'
  | 'possible_duplicate';

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
  // signed storage link, legacy "/uploads/..." path, or null if unavailable
  storageUrl: string | null;
}

export interface StatusLog {
  id: string;
  oldStatus: Status | null;
  newStatus: Status;
  remarks: string | null;
  photoUrl: string | null;
  createdAt: string;
}

export interface Workload {
  assigned: number;
  inProgress: number;
  delayed: number;
  awaitingVerification: number;
  closed: number;
  // assigned + in progress + delayed
  active: number;
}

// a technical role earned through the skills survey
export interface TechnicianRole {
  score: number;
  assignedAt: string;
  tradeUnit: TradeUnit;
}

export interface Technician {
  id: string;
  fullName: string;
  // assigned (primary) trade unit, set by an administrator
  tradeUnit: TradeUnit | null;
  workload: Workload;
  roles: TechnicianRole[];
  surveyCompletedAt: string | null;
  // present when the list was requested for one trade unit
  match?: { primary: boolean; surveyScore: number | null };
}

export interface SurveyUnitDetail {
  tradeUnitId: string;
  name: string;
  score: number;
  qualified: boolean;
  proficiency: string;
  experience: string | null;
  certified: boolean;
  tasks: string[];
  taskCount: number;
}

export interface TechnicianSurveyView {
  technician: {
    id: string;
    fullName: string;
    primaryTradeUnit: TradeUnit | null;
    surveyCompletedAt: string | null;
    roles: TechnicianRole[];
  };
  survey: { submittedAt: string; version: number | null; units: SurveyUnitDetail[] } | null;
  primaryNotQualified: boolean;
}

export type AssignmentStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';

export interface JobAssignment {
  id: string;
  technicianId: string;
  status: AssignmentStatus;
  declineReason: string | null;
  assignedAt: string;
  respondedAt: string | null;
  technician: { id: string; fullName: string };
  assignedBy: { id: string; fullName: string };
}

export interface JobOrderBasic {
  id: string;
  jobOrderNo: string;
  reportId: string;
  tradeUnitId: string;
  technicianId: string | null;
  // the current technician's answer; DECLINED = waiting for reassignment
  assignmentStatus: AssignmentStatus | null;
  // set when cancelled because its report was confirmed as the same problem
  mergedIntoId?: string | null;
  cancelReason?: string | null;
  materialsNote: string | null;
  targetDate: string | null;
  status: Status;
  createdAt: string;
  technician?: { id: string; fullName: string } | null;
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
  feedback: Feedback | null;
  // impact answers (null for reports from older app versions)
  affectedPeople: number | null;
  safetyHazard: boolean | null;
  blocksUse: boolean | null;
  // triage (coordinators only)
  priority: PriorityLevel | null;
  autoPriority: PriorityLevel | null;
  priorityScore: number | null;
  priorityLocked: boolean;
  reviewFlags: ReviewFlagCode[];
  needsReview: boolean;
  duplicateOfId: string | null;
  jobOrderForm?: {
    id: string;
    formNo: string;
    status: FormStatus;
    revision: number;
    submittedAt: string;
    decisionNote: string | null;
  } | null;
  // the report this one is linked to, and the job order handling both
  duplicateOf?: {
    id: string;
    status: Status;
    jobOrder: {
      id: string;
      jobOrderNo: string;
      status: Status;
      technician: { id: string; fullName: string } | null;
    } | null;
  } | null;
  _count?: { duplicateFlags: number };
}

export interface PriorityFactor {
  key: string;
  label: string;
  value: string;
  points: number;
  max: number;
}

export interface PriorityDetails {
  id: string;
  priority: PriorityLevel | null;
  autoPriority: PriorityLevel | null;
  priorityScore: number | null;
  priorityLocked: boolean;
  priorityFactors: PriorityFactor[] | null;
  reviewFlags: ReviewFlagCode[];
  needsReview: boolean;
  reviewedAt: string | null;
  reviewedBy: { id: string; fullName: string } | null;
  priorityAdjustments: {
    id: string;
    fromPriority: PriorityLevel | null;
    toPriority: PriorityLevel;
    reason: string;
    createdAt: string;
    adjustedBy: { id: string; fullName: string };
  }[];
}

export interface ReportSummary {
  id: string;
  status: Status;
  description: string;
  createdAt: string;
  category: { id: string; name: string };
  location: Location;
  jobOrder: {
    id: string;
    jobOrderNo: string;
    status: Status;
    assignmentStatus: AssignmentStatus | null;
    technician: { id: string; fullName: string } | null;
  } | null;
}

export interface DuplicateFlagView {
  id: string;
  score: number;
  status: 'OPEN' | 'CONFIRMED' | 'DISMISSED';
  reasons: { reasons: string[]; likely: boolean };
  reviewedBy: { id: string; fullName: string } | null;
}

export interface DuplicatesView {
  duplicateOfId: string | null;
  possibleOriginals: (DuplicateFlagView & { candidate: ReportSummary })[];
  possibleCopies: (DuplicateFlagView & { report: ReportSummary })[];
  linkedCopies: ReportSummary[];
}

export interface RankedTechnician {
  id: string;
  fullName: string;
  score: number;
  declinedThisJob: boolean;
  reasons: string[];
}

export interface Recommendation {
  tradeUnit: TradeUnit;
  recommended: RankedTechnician | null;
  candidates: RankedTechnician[];
}

export interface RoutingQueueItem {
  id: string;
  status: Status;
  urgency: Urgency;
  description: string;
  createdAt: string;
  priority: PriorityLevel | null;
  priorityScore: number | null;
  reviewFlags: ReviewFlagCode[];
  needsReview: boolean;
  category: { id: string; name: string };
  location: Location;
  proposedTradeUnit: TradeUnit;
  reporter: Reporter;
  _count: { duplicateFlags: number; duplicates: number };
  openDuplicateFlags: number;
  recommendedTechnician: RankedTechnician | null;
  canAutoConfirm: boolean;
}

export interface RoutingQueue {
  linkedDuplicatesWaiting: number;
  items: RoutingQueueItem[];
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
  verifiedAt: string | null;
  verifiedBy: { id: string; fullName: string } | null;
  delays: MaterialDelay[];
  // coordinators/admins only, newest first
  assignments?: JobAssignment[];
  mergedInto?: { id: string; jobOrderNo: string; reportId: string } | null;
  report: {
    id: string;
    description: string;
    urgency: Urgency;
    status: Status;
    priority: PriorityLevel | null;
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
/* ---------------------------------------------------------------- analytics */

export interface DurationStats {
  count: number;
  avgHours: number | null;
  medianHours: number | null;
}
export type Granularity = 'day' | 'week' | 'month';
export interface CountItem {
  id?: string;
  label: string;
  count: number;
}

export interface AnalyticsOverview {
  range: { from: string; to: string; granularity: Granularity; days: number };
  totals: {
    submitted: number;
    uniqueProblems: number;
    pending: number;
    ongoing: number;
    completed: number;
    verified: number;
    unresolved: number;
    unresolvedAfterDays: number;
  };
  series: { keys: string[]; submitted: number[]; completed: number[] };
  byCategory: CountItem[];
  byBuilding: CountItem[];
  topLocations: CountItem[];
  byPriority: CountItem[];
  timing: { toAssign: DurationStats; toComplete: DurationStats };
  technicians: {
    id: string;
    fullName: string;
    tradeUnit: string | null;
    active: number;
    delayed: number;
    offered: number;
    accepted: number;
    declined: number;
    declineRate: number | null;
    completed: number;
    completionRate: number | null;
    completionTime: DurationStats;
  }[];
  options: { categories: { id: string; name: string }[]; buildings: string[] };
}

export interface TechnicianAnalytics {
  technician: {
    id: string;
    fullName: string;
    tradeUnit: TradeUnit | null;
    roles: { name: string; score: number }[];
  };
  range: { from: string; to: string; granularity: Granularity };
  offers: { total: number; accepted: number; declined: number; waiting: number; withdrawn: number };
  jobs: {
    completed: number;
    active: number;
    acceptedInPeriod: number;
    completionRate: number | null;
    completionTime: DurationStats;
  };
  series: { keys: string[]; completed: number[]; accepted: number[] };
  history: {
    id: string;
    status: AssignmentStatus;
    assignedAt: string;
    respondedAt: string | null;
    declineReason: string | null;
    completedAt: string | null;
    hoursToComplete: number | null;
    jobOrder: {
      id: string;
      jobOrderNo: string;
      status: Status;
      reportId: string;
      report: {
        priority: PriorityLevel | null;
        urgency: Urgency;
        category: { name: string };
        location: { building: string; floor: string; room: string };
      };
    };
  }[];
}
