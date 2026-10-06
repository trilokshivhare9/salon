import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable, concat, from } from 'rxjs';
import { filter } from 'rxjs/operators';

export interface SalonRealtimeEvent {
  id: number;
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
  private readonly logger = new Logger(AppointmentEventsService.name);
  private readonly events$ = new Subject<SalonRealtimeEvent>();

  // Monotonic sequential event ID
  private currentEventId = 0;

  // Circular ring buffer per salon (retains last 100 events for Last-Event-ID catchup)
  private readonly ringBuffer = new Map<string, SalonRealtimeEvent[]>();
  private static readonly MAX_BUFFER_PER_SALON = 100;

  getSalonEvents(salonId: string, lastEventId?: string | number): Observable<SalonRealtimeEvent> {
    const liveEvents$ = this.events$.asObservable().pipe(
      filter((event) => event.salonId === salonId),
    );

    if (lastEventId !== undefined && lastEventId !== null && lastEventId !== '') {
      const parsedLastId = typeof lastEventId === 'number' ? lastEventId : parseInt(String(lastEventId), 10);
      if (!isNaN(parsedLastId) && parsedLastId >= 0) {
        const salonBuffer = this.ringBuffer.get(salonId) || [];
        const missedEvents = salonBuffer.filter((e) => e.id > parsedLastId);
        if (missedEvents.length > 0) {
          this.logger.log(
            `[AppointmentEventsService] 🔁 Replaying ${missedEvents.length} missed events for salon ${salonId} (Last-Event-ID: ${parsedLastId})`,
          );
          return concat(from(missedEvents), liveEvents$);
        }
      }
    }

    return liveEvents$;
  }

  emitSalonEvent(salonId: string, type: SalonRealtimeEvent['type'], data: any) {
    this.currentEventId++;
    const event: SalonRealtimeEvent = {
      id: this.currentEventId,
      salonId,
      type,
      data,
      timestamp: new Date().toISOString(),
    };

    // Store in ring buffer
    let salonBuffer = this.ringBuffer.get(salonId);
    if (!salonBuffer) {
      salonBuffer = [];
      this.ringBuffer.set(salonId, salonBuffer);
    }

    salonBuffer.push(event);
    if (salonBuffer.length > AppointmentEventsService.MAX_BUFFER_PER_SALON) {
      salonBuffer.shift();
    }

    this.events$.next(event);
  }
}
