import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { AppointmentStatus } from '@prisma/client';
import {
  UpdateAppointmentStatusDto,
  STATUS_ALIAS_MAP,
} from '../../../../src/modules/salon-admin/appointments/dto/create-appointment.dto';
import { VALID_STATUS_TRANSITIONS } from '../../../../src/modules/salon-admin/appointments/utils/appointment-helpers';

describe('Appointment Status Contract Integrity & Ingress Adapter (SSOT)', () => {
  describe('Pillar 2: Backend Ingress Normalization (@Transform)', () => {
    it('should automatically transform legacy "IN_SERVICE" to AppointmentStatus.SEATED_IN_CHAIR', async () => {
      const payload = { status: 'IN_SERVICE' };
      const dto = plainToInstance(UpdateAppointmentStatusDto, payload);

      expect(dto.status).toBe(AppointmentStatus.SEATED_IN_CHAIR);

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should transform case-insensitive "in_service" and trim whitespace', async () => {
      const payload = { status: '  in_service  ' };
      const dto = plainToInstance(UpdateAppointmentStatusDto, payload);

      expect(dto.status).toBe(AppointmentStatus.SEATED_IN_CHAIR);

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept official AppointmentStatus.SEATED_IN_CHAIR directly', async () => {
      const payload = { status: 'SEATED_IN_CHAIR' };
      const dto = plainToInstance(UpdateAppointmentStatusDto, payload);

      expect(dto.status).toBe(AppointmentStatus.SEATED_IN_CHAIR);

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should accept all valid official AppointmentStatus enum values', async () => {
      for (const status of Object.values(AppointmentStatus)) {
        const dto = plainToInstance(UpdateAppointmentStatusDto, { status });
        const errors = await validate(dto);
        expect(errors.length).toBe(0);
      }
    });

    it('should reject unknown invalid status strings with validation error', async () => {
      const payload = { status: 'INVALID_STATUS_XYZ' };
      const dto = plainToInstance(UpdateAppointmentStatusDto, payload);

      const errors = await validate(dto);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0].constraints).toHaveProperty('isEnum');
    });

    it('should verify registered STATUS_ALIAS_MAP covers critical legacy aliases', () => {
      expect(STATUS_ALIAS_MAP.IN_SERVICE).toBe(AppointmentStatus.SEATED_IN_CHAIR);
      expect(STATUS_ALIAS_MAP.ARRIVED).toBe(AppointmentStatus.CHECKED_IN);
      expect(STATUS_ALIAS_MAP.DONE).toBe(AppointmentStatus.COMPLETED);
    });
  });

  describe('Pillar 3: State Machine Transition Integrity', () => {
    it('should permit valid transition: CHECKED_IN -> SEATED_IN_CHAIR', () => {
      const allowed = VALID_STATUS_TRANSITIONS[AppointmentStatus.CHECKED_IN];
      expect(allowed).toContain(AppointmentStatus.SEATED_IN_CHAIR);
    });

    it('should permit valid transition: SEATED_IN_CHAIR -> COMPLETED', () => {
      const allowed = VALID_STATUS_TRANSITIONS[AppointmentStatus.SEATED_IN_CHAIR];
      expect(allowed).toContain(AppointmentStatus.COMPLETED);
    });

    it('should permit emergency cancellation: SEATED_IN_CHAIR -> CANCELLED', () => {
      const allowed = VALID_STATUS_TRANSITIONS[AppointmentStatus.SEATED_IN_CHAIR];
      expect(allowed).toContain(AppointmentStatus.CANCELLED);
    });

    it('should forbid terminal states from transitioning', () => {
      expect(VALID_STATUS_TRANSITIONS[AppointmentStatus.COMPLETED]).toEqual([]);
      expect(VALID_STATUS_TRANSITIONS[AppointmentStatus.CANCELLED]).toEqual([]);
      expect(VALID_STATUS_TRANSITIONS[AppointmentStatus.REJECTED]).toEqual([]);
    });
  });
});
