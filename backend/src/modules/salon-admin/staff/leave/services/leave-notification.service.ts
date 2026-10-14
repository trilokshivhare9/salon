import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class LeaveNotificationService {
  private readonly logger = new Logger(LeaveNotificationService.name);

  /**
   * Handled centrally by ScheduleConflictResolutionEngine via WhatsApp interactive reschedule proposals.
   */
  async sendAbsenceNotification(appointmentId: string): Promise<void> {
    this.logger.debug(`Absence notification for appointment ${appointmentId} is managed centrally via WhatsApp reschedule.`);
  }
}
