import { Injectable } from '@nestjs/common';
import { Subject, Observable } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface SalonRealtimeEvent {
  salonId: string;
  type:
    | 'NEW_BOOKING'
    | 'STATUS_UPDATED'
    | 'RESCHEDULED'
    | 'CANCELLED'
    | 'BOOKING_CANCELLED'
    | 'APPOINTMENT_UPDATED'
    | 'STAFF_UPDATED'
    | 'SERVICE_UPDATED';
  data: any;
  timestamp: string;
}

@Injectable()
export class AppointmentEventsService {
  private readonly events$ = new Subject<SalonRealtimeEvent>();

  getSalonEvents(salonId: string): Observable<SalonRealtimeEvent> {
    return this.events$.asObservable().pipe(
      filter((event) => event.salonId === salonId),
    );
  }

  emitSalonEvent(salonId: string, type: SalonRealtimeEvent['type'], data: any) {
    this.events$.next({
      salonId,
      type,
      data,
      timestamp: new Date().toISOString(),
    });
  }
}
