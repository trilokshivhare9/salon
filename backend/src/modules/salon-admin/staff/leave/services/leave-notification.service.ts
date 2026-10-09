import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../../../../database/prisma.service';
import { WhatsAppService } from '../../../../channels/whatsapp/whatsapp.service';

@Injectable()
export class LeaveNotificationService {
  private readonly logger = new Logger(LeaveNotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(forwardRef(() => WhatsAppService))
    private readonly whatsappService: WhatsAppService,
  ) {}

  /**
   * Dispatches WhatsApp notification for an individual reassignment asynchronously.
   */
  async sendAbsenceNotification(reassignmentId: string): Promise<void> {
    try {
      const reassignment = await this.prisma.bookingReassignment.findUnique({
        where: { id: reassignmentId },
        include: {
          appointment: {
            include: {
              salonUser: { include: { user: true } },
              stylist: true,
            },
          },
          absence: {
            include: {
              stylist: true,
              salon: { include: { whatsappAccount: true } },
            },
          },
        },
      });

      if (!reassignment || !reassignment.appointment) {
        this.logger.warn(`Reassignment ${reassignmentId} or related appointment not found.`);
        return;
      }

      const salon = reassignment.absence?.salon;
      if (!salon || !salon.whatsappAccount || !salon.whatsappAccount.isActive) {
        this.logger.debug(`WhatsApp account not active for salon ${salon?.id}. Skipping notification.`);
        return;
      }

      const customerPhone = reassignment.appointment.salonUser?.user?.phone;
      if (!customerPhone) {
        this.logger.warn(`Customer phone missing for appointment ${reassignment.appointment.id}.`);
        return;
      }

      const customerName = reassignment.appointment.salonUser?.user?.name || 'Valued Customer';
      const originalStylistName = reassignment.absence?.stylist?.name || 'Specialist';
      const newStylistName = reassignment.appointment.stylist?.name || 'our senior team';
      const salonName = salon.name;
      const apptDate = reassignment.originalStartAt.toISOString().split('T')[0];

      await this.whatsappService.sendMetaTemplateMessage(
        customerPhone,
        'appointment_stylist_reassigned',
        [
          { type: 'text', text: customerName },
          { type: 'text', text: salonName },
          { type: 'text', text: originalStylistName },
          { type: 'text', text: newStylistName },
          { type: 'text', text: apptDate },
        ],
        'en',
        salon.whatsappAccount.phoneNumberId,
        salon.id,
      );

      await this.prisma.bookingReassignment.update({
        where: { id: reassignmentId },
        data: {
          notificationSentAt: new Date(),
          notificationFailed: false,
        },
      });

      this.logger.log(`WhatsApp reassignment alert successfully dispatched for appointment ${reassignment.appointment.id}.`);
    } catch (err: any) {
      this.logger.error(`Failed to dispatch WhatsApp notification for reassignment ${reassignmentId}: ${err.message}`, err.stack);
      await this.prisma.bookingReassignment.update({
        where: { id: reassignmentId },
        data: { notificationFailed: true },
      }).catch(() => {});
    }
  }
}
