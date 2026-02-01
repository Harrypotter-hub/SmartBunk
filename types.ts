export enum DayOfWeek {
  Sunday = 0,
  Monday = 1,
  Tuesday = 2,
  Wednesday = 3,
  Thursday = 4,
  Friday = 5,
  Saturday = 6,
}

export interface AttendanceRecord {
  id: string;
  date: string; // ISO YYYY-MM-DD
  status: 'PRESENT' | 'ABSENT';
  timestamp: number;
}

export interface Subject {
  id: string;
  name: string;
  attended: number;
  total: number;
  schedule: DayOfWeek[];
  startDate: string; // ISO Date string YYYY-MM-DD
  endDate: string;   // ISO Date string YYYY-MM-DD
  startTime?: string; // "HH:mm" 24-hour format
  history: AttendanceRecord[]; 
  initialAttended?: number; // Stores the manual count entered during creation/edit
  initialTotal?: number;    // Stores the manual total offset (e.g. for migration)
}

export type AttendanceStatus = 'SAFE' | 'DANGER' | 'IMPOSSIBLE';

export interface CalculationResult {
  status: AttendanceStatus;
  percentage: number;
  
  // Projection Data
  classesHeldSoFar: number;
  classesLeftRaw: number;
  totalSemesterClasses: number;
  
  // Advice
  bunksAvailable: number; // How many can I skip and stay above Target?
  classesToRecover: number; // How many MUST I attend consecutively?
  maxPossiblePercentage: number; // Ceiling if I attend everything
}

export interface AppSettings {
  // Notifications
  notificationsEnabled: boolean;
  dailyReminder: boolean;
  dailyReminderTime: string; // "HH:mm"
  classReminders: boolean; // Remind 15 mins before class
  
  // Criteria
  targetPercentage: number; // 0.0 to 1.0 (e.g. 0.75 for 75%)
}