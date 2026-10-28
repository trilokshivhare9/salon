/**
 * WhatsApp Conversation Test Harness
 *
 * Wires the REAL WhatsApp conversation stack (gateway, session, actions, templates)
 * on top of a deterministic InMemoryPrisma and mocked domain services.
 *
 * Every outbound message is captured at the single lowest-level send point
 * (`WhatsAppSenderService.sendMetaMessage`), so messages sent through ANY path
 * (action handlers, session expiry replies, etc.) are observed.
 *
 * Usage:
 *   const h = await createWhatsAppHarness({ conversation: { state: 'SELECT_STAFF', selectedServiceId: SVC_HAIRCUT } });
 *   await h.tap('staff_any');
 *   expect(h.conversation.state).toBe('SELECT_DATE');
 *   expect(h.optionIds(h.lastMessage)).toContain(`date_${h.dates.tomorrow}`);
 */
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppointmentStatus, ServiceGender } from '@prisma/client';
import { DateTime } from 'luxon';
import { PrismaService } from '../../../../../src/database/prisma.service';
import { WhatsAppService } from '../../../../../src/modules/channels/whatsapp/whatsapp.service';
import { AvailabilityService } from '../../../../../src/modules/salon-admin/availability/availability.service';
import { AppointmentsService } from '../../../../../src/modules/salon-admin/appointments/appointments.service';
import { CancellationService } from '../../../../../src/modules/salon-admin/appointments/cancellation/cancellation.service';
import { RescheduleService } from '../../../../../src/modules/salon-admin/appointments/reschedule/reschedule.service';
import { QuickCodeService } from '../../../../../src/modules/salon-admin/quick-booking/quick-code.service';
import { QuickBookingService } from '../../../../../src/modules/salon-admin/quick-booking/quick-booking.service';
import { InMemoryPrisma } from './in-memory-prisma';

export const SALON_ID = 'salon-harness-1';
export const CUSTOMER_PHONE = '919876500001';
export const USER_ID = 'user-harness-1';
export const SALON_USER_ID = 'salon-user-harness-1';
export const TZ = 'Asia/Kolkata';

export const CAT_HAIR = 'cat-hair';
export const CAT_SPA = 'cat-spa';
export const SVC_HAIRCUT = 'svc-haircut';
export const SVC_SPA = 'svc-spa';
export const STYLIST_ALICE = 'stylist-alice';
export const STYLIST_BOB = 'stylist-bob';

export const buildSalonFixture = () => ({
  id: SALON_ID,
  name: 'Harness Salon',
  phone: '+919000000000',
  address: '1 Test Street',
  status: 'ACTIVE',
  timezone: TZ,
  cancelWindowHours: 2,
  googleMapsUrl: null,
  serviceCategories: [
    { id: CAT_HAIR, name: 'Hair Care', sortOrder: 1 },
    { id: CAT_SPA, name: 'Spa & Wellness', sortOrder: 2 },
  ],
  services: [
    {
      id: SVC_HAIRCUT,
      name: 'Men Haircut',
      serviceCategoryId: CAT_HAIR,
      price: 500,
      durationMinutes: 30,
      gender: ServiceGender.UNISEX,
      status: 'ACTIVE',
    },
    {
      id: SVC_SPA,
      name: 'Head Spa',
      serviceCategoryId: CAT_SPA,
      price: 1200,
      durationMinutes: 45,
      gender: ServiceGender.UNISEX,
      status: 'ACTIVE',
    },
  ],
  stylists: [
    { id: STYLIST_ALICE, name: 'Alice', status: 'ACTIVE', services: [{ serviceId: SVC_HAIRCUT }, { serviceId: SVC_SPA }] },
    { id: STYLIST_BOB, name: 'Bob', status: 'ACTIVE', services: [{ serviceId: SVC_SPA }] },
  ],
});

export interface HarnessOptions {
  /** Initial conversation row (merged over defaults). Omit to start with no conversation. */
  conversation?: Record<string, any>;
  /** Pre-existing appointments for the harness customer. */
  appointments?: Array<Record<string, any>>;
  /** Override salon fixture fields. */
  salon?: Record<string, any>;
}

export interface SentMessage {
  to: string;
  payload: any;
}

export type WhatsAppHarness = Awaited<ReturnType<typeof createWhatsAppHarness>>;

export async function createWhatsAppHarness(opts: HarnessOptions = {}) {
  const now = DateTime.now().setZone(TZ);
  const dates = {
    today: now.toISODate() as string,
    tomorrow: now.plus({ days: 1 }).toISODate() as string,
    dayAfter: now.plus({ days: 2 }).toISODate() as string,
  };

  const salon = { ...buildSalonFixture(), ...(opts.salon || {}) };

  const prisma = new InMemoryPrisma({
    salons: [salon],
    users: [{ id: USER_ID, phone: `+${CUSTOMER_PHONE}`, name: 'Harness Customer' }],
    salonUsers: [{ id: SALON_USER_ID, salonId: SALON_ID, userId: USER_ID, isBookingBlocked: false }],
    conversations: opts.conversation ? [{ salonId: SALON_ID, customerPhone: CUSTOMER_PHONE, ...opts.conversation }] : [],
    appointments: (opts.appointments || []).map((a) => ({ salonId: SALON_ID, salonUserId: SALON_USER_ID, ...a })),
  });

  const slotsFor = (date: string) => ({
    date,
    salonTimezone: TZ,
    serviceDurationMinutes: 30,
    status: 'AVAILABLE',
    statusReason: 'Slots available',
    availableSlots: ['10:00', '11:00', '16:00'].map((t) => ({
      startTime: t,
      endTime: DateTime.fromISO(`${date}T${t}`, { zone: TZ }).plus({ minutes: 30 }).toFormat('HH:mm'),
      availableStaffCount: 1,
      eligibleStaffIds: [STYLIST_ALICE],
    })),
  });

  // Mirrors the real AvailabilityService contract for unknown / deleted services:
  // - getAvailableSlots throws NotFoundException
  // - findAvailableDates swallows per-day errors and returns []
  const isKnownService = (serviceIdOrIds: string | string[]) => {
    const ids = Array.isArray(serviceIdOrIds) ? serviceIdOrIds : [serviceIdOrIds];
    return ids.length > 0 && ids.every((id) => salon.services.some((s: any) => s.id === id && s.status === 'ACTIVE'));
  };

  const availability = {
    getQualifiedStylists: jest.fn(async (_salonId: string, serviceIdOrIds: string | string[]) => {
      const ids = Array.isArray(serviceIdOrIds) ? serviceIdOrIds : [serviceIdOrIds];
      return salon.stylists.filter((st: any) => ids.every((id) => st.services.some((s: any) => s.serviceId === id)));
    }),
    findAvailableDates: jest.fn(async (_salonId: string, serviceIdOrIds: string | string[]) =>
      isKnownService(serviceIdOrIds)
        ? [
            { dateStr: dates.tomorrow, displayLabel: 'Tomorrow' },
            { dateStr: dates.dayAfter, displayLabel: 'Day After' },
          ]
        : [],
    ),
    getAvailableSlots: jest.fn(async (_s: string, serviceIdOrIds: string | string[], date: string) => {
      if (!isKnownService(serviceIdOrIds)) {
        throw new NotFoundException('One or more selected services are inactive or do not exist.');
      }
      return slotsFor(date);
    }),
    isQuickBookingOperationalToday: jest.fn(async () => true),
    invalidateSalonScheduleCache: jest.fn(),
    findEarliestAvailableSlotToday: jest.fn(async () => null),
  };

  const modifier = { modifyStatus: jest.fn(async () => true) };
  const appointments = {
    createAppointment: jest.fn(async (_salonId: string, dto: any) => {
      const created = await prisma.appointment.create({
        data: {
          appointmentNumber: `APT-${prisma.tables.appointment.length + 1}`,
          salonId: SALON_ID,
          salonUserId: SALON_USER_ID,
          serviceId: dto?.serviceId ?? null,
          stylistId: dto?.stylistId ?? STYLIST_ALICE,
          status: AppointmentStatus.BOOKED,
          startAt: new Date(Date.now() + 24 * 3600 * 1000),
          price: 500,
        },
      });
      return { ...created, startTime: created.startAt, service: { name: 'Men Haircut' }, stylist: { name: 'Alice' } };
    }),
    getAppointmentById: jest.fn(async (_salonId: string, id: string) => prisma.appointment.findUnique({ where: { id } })),
    getModifierService: jest.fn(() => modifier),
    updateEtaStatus: jest.fn(async () => true),
    emitSalonEvent: jest.fn(),
    updateStatus: jest.fn(async () => true),
  };

  const cancellation = {
    cancelBooking: jest.fn(async () => true),
    checkCancellationPenalty: jest.fn(async () => ({
      willIncurPenalty: false,
      hoursUntil: 24,
      cancelWindowHours: 2,
      apptStart: new Date(Date.now() + 24 * 3600 * 1000),
    })),
  };
  const reschedule = {
    rescheduleAppointment: jest.fn(async () => true),
    validateRescheduleEligibility: jest.fn(async () => ({ allowed: true, hoursUntil: 24, cancelWindowHours: 2 })),
  };
  const quickCode = { verifyCode: jest.fn(), getOrCreateTodayCode: jest.fn() };
  const quickBooking = {
    confirmQuickBooking: jest.fn(),
    findNextAvailableSlot: jest.fn(async () => null),
    getOperatingStatus: jest.fn(async () => ({ isOpen: true })),
  };

  const moduleRef = await Test.createTestingModule({
    providers: [
      WhatsAppService,
      { provide: PrismaService, useValue: prisma },
      { provide: ConfigService, useValue: { get: jest.fn() } },
      { provide: AvailabilityService, useValue: availability },
      { provide: AppointmentsService, useValue: appointments },
      { provide: CancellationService, useValue: cancellation },
      { provide: RescheduleService, useValue: reschedule },
      { provide: QuickCodeService, useValue: quickCode },
      { provide: QuickBookingService, useValue: quickBooking },
    ],
  }).compile();

  const whatsAppService = moduleRef.get(WhatsAppService);
  const sender = (whatsAppService as any).whatsAppSenderService;

  // Capture EVERY outbound message at the single lowest-level send point.
  const sent: SentMessage[] = [];
  jest.spyOn(sender, 'sendMetaMessage').mockImplementation(async (to: any, payload: any) => {
    sent.push({ to, payload: structuredClone(payload) });
    return true;
  });

  const cleanPhone: string = sender.cleanPhone(CUSTOMER_PHONE);

  /** Flushes `setImmediate` callbacks so background writes are observable. */
  const flushBackground = () => new Promise((resolve) => setImmediate(resolve));

  /**
   * Delivers one inbound message exactly like the production webhook queue does:
   * handler errors are caught and logged (the customer receives nothing), never re-thrown.
   * `error` is exposed so tests can assert on silent failures.
   */
  const deliver = async (text: string, interactiveId?: string) => {
    const before = sent.length;
    let result: any;
    let error: unknown;
    try {
      result = await whatsAppService.handleIncomingMessage(
        SALON_ID,
        CUSTOMER_PHONE,
        text,
        interactiveId,
        'simulator',
        'Harness Customer',
      );
    } catch (err) {
      error = err;
    }
    await flushBackground();
    return { result, error, messages: sent.slice(before).map((m) => m.payload) };
  };

  const optionIds = (payload: any): string[] => {
    if (!payload) return [];
    const ids: string[] = [];
    (payload.buttons || []).forEach((b: any) => ids.push(b.id));
    (payload.listRows || []).forEach((r: any) => ids.push(r.id));
    (payload.sections || []).forEach((s: any) => (s.rows || []).forEach((r: any) => ids.push(r.id)));
    return ids;
  };

  const bodyOf = (payload: any): string => payload?.bodyText || payload?.textBody || '';

  return {
    prisma,
    whatsAppService,
    sender,
    dates,
    mocks: { availability, appointments, cancellation, reschedule, quickCode, quickBooking, modifier },
    sent,
    optionIds,
    bodyOf,
    flushBackground,

    /** Simulates the customer tapping a button / list row with the given ID. */
    tap: (id: string, title?: string) => deliver(title || id, id),
    /** Simulates the customer typing free text. */
    type: (text: string) => deliver(text),

    /** Live persisted conversation row for the harness customer. */
    get conversation(): Record<string, any> {
      const row = prisma.getConversation(SALON_ID, cleanPhone) || prisma.getConversation(SALON_ID, CUSTOMER_PHONE);
      if (!row) throw new Error('Harness: no conversation row exists yet');
      return row;
    },
    get lastMessage(): any {
      return sent.length ? sent[sent.length - 1].payload : undefined;
    },
    /** Directly patches the persisted conversation (bypasses @updatedAt refresh when updatedAt is given). */
    patchConversation(patch: Record<string, any>) {
      const row = prisma.getConversation(SALON_ID, cleanPhone) || prisma.getConversation(SALON_ID, CUSTOMER_PHONE);
      if (!row) throw new Error('Harness: no conversation row exists yet');
      Object.assign(row, patch);
    },
    clearSent() {
      sent.length = 0;
    },
  };
}
