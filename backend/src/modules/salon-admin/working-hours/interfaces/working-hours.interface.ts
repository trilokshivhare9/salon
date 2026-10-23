import { DayOfWeek } from '@prisma/client';

export interface ISalonDayWorkingHour {
  id: string;
  salonId: string;
  dayOfWeek: DayOfWeek;
  isClosed: boolean;
  startTime: string;
  endTime: string;
  breaks?: Array<{
    id: string;
    title: string;
    startTime: string;
    endTime: string;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStaffDayWorkingHour {
  id: string;
  salonId: string;
  stylistId: string;
  salonWorkingHoursId: string | null;
  dayOfWeek: DayOfWeek;
  isWorking: boolean;
  isCustomized: boolean;
  startTime: string;
  endTime: string;
  salonIsClosed: boolean;
  canWork: boolean;
  breaks?: Array<{
    id: string;
    title: string;
    startTime: string;
    endTime: string;
    isCustomized: boolean;
  }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface IStaffWorkingHoursResponse {
  stylistId: string;
  stylistName: string;
  followsSalonSchedule: boolean;
  hours: IStaffDayWorkingHour[];
}

export interface IWorkingHoursPropagationResult {
  updatedStylistsCount: number;
  updatedDaysCount: number;
  enforcedClosedDaysCount: number;
}
