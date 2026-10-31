import { QueueItem, QueueItemService } from '../interfaces/queue-response.interface';

/**
 * Pure mapper transforming Prisma Appointment entity into the canonical QueueItem model.
 * Used identically for REST responses and real-time SSE event payloads.
 */
export function mapToQueueItem(appt: any): QueueItem {
  if (!appt) {
    throw new Error('Cannot map null or undefined appointment to QueueItem');
  }

  const rawServices = appt.services && Array.isArray(appt.services) && appt.services.length > 0
    ? appt.services
    : [];

  const services: QueueItemService[] = rawServices.length > 0
    ? rawServices.map((s: any) => ({
        id: String(s.id),
        serviceId: s.serviceId ? String(s.serviceId) : null,
        name: s.serviceNameSnapshot || s.service?.name || 'Service',
        durationMinutes: Number(s.durationMinutes) || 0,
        price: Number(s.price) || 0,
        orderIndex: Number(s.orderIndex) || 0,
      }))
    : [
        {
          id: 'primary',
          serviceId: appt.serviceId ? String(appt.serviceId) : null,
          name: appt.serviceNameSnapshot || appt.service?.name || 'Service',
          durationMinutes: Number(appt.durationMinutes) || 30,
          price: Number(appt.price) || 0,
          orderIndex: 0,
        },
      ];

  const totalDurationMinutes =
    services.reduce((sum, s) => sum + (s.durationMinutes || 0), 0) ||
    Number(appt.durationMinutes) ||
    30;

  const totalPrice =
    services.reduce((sum, s) => sum + (s.price || 0), 0) ||
    Number(appt.price) ||
    0;

  return {
    id: String(appt.id),
    appointmentNumber: String(appt.appointmentNumber || ''),
    status: String(appt.status || 'BOOKED'),
    source: String(appt.source || 'WHATSAPP'),
    bookingType: String(appt.bookingType || 'NORMAL'),
    startAt: appt.startAt,
    endAt: appt.endAt,
    proposedStartAt: appt.proposedStartAt || null,
    proposedEndAt: appt.proposedEndAt || null,
    proposedStylistId: appt.proposedStylistId ? String(appt.proposedStylistId) : null,
    expiresAt: appt.expiresAt || null,
    customer: {
      id: String(appt.salonUser?.id || appt.salonUserId || ''),
      name: String(appt.salonUser?.user?.name || appt.customer?.name || appt.user?.name || 'Client'),
      phone: String(appt.salonUser?.user?.phone || appt.customer?.phone || appt.user?.phone || ''),
      email: appt.salonUser?.user?.email || appt.customer?.email || appt.user?.email || null,
    },
    stylist: {
      id: String(appt.stylist?.id || appt.stylistId || ''),
      name: String(appt.stylist?.name || 'Unassigned'),
      avatarUrl: appt.stylist?.avatarUrl || null,
      colorCode: String(appt.stylist?.colorCode || '#3B82F6'),
    },
    services,
    totalDurationMinutes,
    totalPrice,
    nextActionType: appt.nextActionType ? String(appt.nextActionType) : null,
    nextActionAt: appt.nextActionAt || null,
    cancellationReason: appt.cancellationReason ? String(appt.cancellationReason) : null,
    cancelledAt: appt.cancelledAt || null,
    notes: appt.notes ? String(appt.notes) : null,
    createdAt: appt.createdAt,
    updatedAt: appt.updatedAt,
  };
}
