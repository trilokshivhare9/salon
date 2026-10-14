import { DayOfWeek } from '@prisma/client';

export interface RoutineBreakSummary {
  routineKey: string;
  title: string;
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  breakIds: Record<string, string>; // dayOfWeek -> breakId
  isCustomized?: boolean;
  salonBreakId?: string | null;
}

export interface SalonBreaksListResponse {
  totalBreaks: number;
  routineBreaks: RoutineBreakSummary[];
  byDay: Record<string, Array<{
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    createdAt?: Date;
    updatedAt?: Date;
  }>>;
}

export interface InheritableSalonBreakSummary {
  salonBreakId: string;
  title: string;
  startTime: string;
  endTime: string;
  days: DayOfWeek[];
  isAlreadyInherited: boolean;
  canInherit: boolean;
  conflictReason?: string | null;
  conflictingBreakIds?: string[];
}

export interface StaffBreaksListResponse {
  stylistId: string;
  followsSalonSchedule: boolean;
  totalBreaks: number;
  routineBreaks: RoutineBreakSummary[];
  inheritableSalonBreaks: InheritableSalonBreakSummary[];
  byDay: Record<string, Array<{
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    isCustomized: boolean;
    salonBreakId: string | null;
  }>>;
}

