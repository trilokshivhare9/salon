import { Injectable } from '@nestjs/common';

export enum SlotWindowType {
  EARLIEST = 'EARLIEST',
  MORNING = 'MORNING',
  AFTERNOON = 'AFTERNOON',
  EVENING = 'EVENING',
}

export interface SlotItem {
  timeStr: string;     // "HH:mm", e.g. "10:30"
  displayTime: string; // "10:30 AM"
}

export interface WindowedSlotMenuOptions {
  isToday?: boolean;
  nowMinutes?: number;
  salonName?: string;
  isReschedule?: boolean;
}

export interface InteractiveSectionRow {
  id: string;
  title: string;
  description?: string;
}

export interface InteractiveSection {
  title: string;
  rows: InteractiveSectionRow[];
}

export interface WindowedSlotMenuResult {
  headerText: string;
  bodyText: string;
  buttonText: string;
  interactiveType: 'list';
  sections: InteractiveSection[];
  listRows: InteractiveSectionRow[]; // Flattened fallback
}

@Injectable()
export class TimeSlotWindowEngine {
  /**
   * Parse "HH:mm" into minutes from start of day.
   */
  private parseMinutes(timeStr: string): number {
    const [h, m] = timeStr.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  /**
   * Format human-friendly row subtitle differentiating Instant Confirmed vs Quick Book (<15m).
   */
  private getSlotSubtitle(s: SlotItem, options?: WindowedSlotMenuOptions): string {
    if (options?.isToday && options.nowMinutes !== undefined) {
      const slotMins = this.parseMinutes(s.timeStr);
      const diff = slotMins - options.nowMinutes;
      if (diff >= 0 && diff < 15) {
        return '⚡ Quick Book (<15m) · Salon Confirms';
      }
    }
    return '✅ Instant Auto-Confirmed';
  }

  /**
   * Build a WhatsApp 10-row compliant interactive menu with diurnal partitioning.
   * Ensures zero false-busy gaps within any active window and gives instant jumpers
   * to afternoon/evening slots without requiring multi-step chat bubbles.
   */
  buildWindowedMenu(
    slots: SlotItem[],
    prefix: string = 'slot_',
    activeWindow: SlotWindowType = SlotWindowType.EARLIEST,
    options?: WindowedSlotMenuOptions,
  ): WindowedSlotMenuResult {
    const windowPrefix = prefix.startsWith('r') ? 'rwindow_' : 'window_';

    // Edge Case: 10 or fewer slots total -> Show all directly in 1 section
    if (slots.length <= 10) {
      const hasQuick = Boolean(
        options?.isToday &&
        options.nowMinutes !== undefined &&
        slots.some((s) => {
          const diff = this.parseMinutes(s.timeStr) - (options.nowMinutes || 0);
          return diff >= 0 && diff < 15;
        })
      );

      const rows: InteractiveSectionRow[] = slots.map((s) => ({
        id: `${prefix}${s.timeStr}`,
        title: s.displayTime,
        description: this.getSlotSubtitle(s, options),
      }));

      let body = options?.isReschedule
        ? 'Please pick a new appointment time slot below:'
        : 'Please pick an available time slot below:';

      if (hasQuick) {
        body += '\n\n⚡ *Quick Booking Notice:*\nSlots starting in *less than 15 minutes* are sent as an express *Quick Booking Request* (our salon team will review & confirm your chair immediately!).';
      }

      return {
        headerText: '🕒 Select Time Slot',
        bodyText: body,
        buttonText: 'View Time Slots',
        interactiveType: 'list',
        sections: [
          {
            title: 'Available Slots',
            rows,
          },
        ],
        listRows: rows,
      };
    }

    // Partition all slots by diurnal window:
    // Morning: < 12:00 (720m)
    // Afternoon: 12:00 to 17:00 (720m to 1020m)
    // Evening: >= 17:00 (1020m)
    const morningSlots: SlotItem[] = [];
    const afternoonSlots: SlotItem[] = [];
    const eveningSlots: SlotItem[] = [];

    for (const s of slots) {
      const m = this.parseMinutes(s.timeStr);
      if (m < 720) {
        morningSlots.push(s);
      } else if (m < 1020) {
        afternoonSlots.push(s);
      } else {
        eveningSlots.push(s);
      }
    }

    let primarySectionTitle = '🕒 Earliest Available';
    let slotRowsToDisplay: SlotItem[] = [];
    const navigationRows: InteractiveSectionRow[] = [];

    if (activeWindow === SlotWindowType.AFTERNOON && afternoonSlots.length > 0) {
      primarySectionTitle = '☀️ Afternoon Slots';
      slotRowsToDisplay = afternoonSlots.slice(0, 8);

      if (eveningSlots.length > 0) {
        navigationRows.push({
          id: `${windowPrefix}${SlotWindowType.EVENING}`,
          title: '🌆 Evening Slots',
          description: `View ${eveningSlots.length} evening slots (5 PM – Close)`,
        });
      }

      navigationRows.push({
        id: `${windowPrefix}${SlotWindowType.EARLIEST}`,
        title: '🌅 Earliest Slots',
        description: 'Back to morning & earliest times',
      });
    } else if (activeWindow === SlotWindowType.EVENING && eveningSlots.length > 0) {
      primarySectionTitle = '🌆 Evening Slots';
      slotRowsToDisplay = eveningSlots.slice(0, 9);

      navigationRows.push({
        id: `${windowPrefix}${SlotWindowType.EARLIEST}`,
        title: '🌅 Earliest Slots',
        description: 'Back to morning & afternoon times',
      });
    } else {
      // Default: EARLIEST (or MORNING)
      // Take first 8 consecutive slots to leave room for Afternoon and Evening jumpers
      primarySectionTitle = '🕒 Earliest Available';

      // Check if subsequent afternoon or evening slots exist beyond the first 8 slots
      const first8 = slots.slice(0, 8);
      const remainingSlots = slots.slice(8);
      const hasLaterAfternoon = remainingSlots.some((s) => this.parseMinutes(s.timeStr) >= 720 && this.parseMinutes(s.timeStr) < 1020);
      const hasLaterEvening = remainingSlots.some((s) => this.parseMinutes(s.timeStr) >= 1020);

      if (hasLaterAfternoon && hasLaterEvening) {
        slotRowsToDisplay = first8;
        navigationRows.push({
          id: `${windowPrefix}${SlotWindowType.AFTERNOON}`,
          title: '☀️ Afternoon Slots',
          description: `View ${afternoonSlots.length} afternoon slots (12 PM – 5 PM)`,
        });
        navigationRows.push({
          id: `${windowPrefix}${SlotWindowType.EVENING}`,
          title: '🌆 Evening Slots',
          description: `View ${eveningSlots.length} evening slots (5 PM – Close)`,
        });
      } else if (hasLaterEvening) {
        slotRowsToDisplay = slots.slice(0, 9);
        navigationRows.push({
          id: `${windowPrefix}${SlotWindowType.EVENING}`,
          title: '🌆 Evening Slots',
          description: `View ${eveningSlots.length} evening slots (5 PM – Close)`,
        });
      } else if (hasLaterAfternoon) {
        slotRowsToDisplay = slots.slice(0, 9);
        navigationRows.push({
          id: `${windowPrefix}${SlotWindowType.AFTERNOON}`,
          title: '☀️ Afternoon Slots',
          description: `View ${afternoonSlots.length} afternoon slots (12 PM – 5 PM)`,
        });
      } else {
        slotRowsToDisplay = slots.slice(0, 10);
      }
    }

    const mappedSlotRows: InteractiveSectionRow[] = slotRowsToDisplay.map((s) => ({
      id: `${prefix}${s.timeStr}`,
      title: s.displayTime,
      description: this.getSlotSubtitle(s, options),
    }));

    const sections: InteractiveSection[] = [
      {
        title: primarySectionTitle.slice(0, 24),
        rows: mappedSlotRows,
      },
    ];

    if (navigationRows.length > 0) {
      sections.push({
        title: '⏩ More Times Today',
        rows: navigationRows,
      });
    }

    // Flat rows array ensuring total <= 10 for backwards compatibility
    const allRows = [...mappedSlotRows, ...navigationRows].slice(0, 10);

    const hasQuickSlots = Boolean(
      options?.isToday &&
      options.nowMinutes !== undefined &&
      slotRowsToDisplay.some((s) => {
        const diff = this.parseMinutes(s.timeStr) - (options.nowMinutes || 0);
        return diff >= 0 && diff < 15;
      })
    );

    let bodyText = activeWindow === SlotWindowType.EARLIEST
      ? (options?.isReschedule ? 'Please pick a new appointment time slot below, or jump to afternoon/evening:' : 'Please pick an available time slot below, or jump to afternoon/evening:')
      : `Showing ${primarySectionTitle.toLowerCase()}. Pick an available slot or switch time:`;

    if (hasQuickSlots) {
      bodyText += '\n\n⚡ *Quick Booking Notice:*\nSlots starting in *less than 15 minutes* are sent as an express *Quick Booking Request* (our salon team will review & confirm your chair immediately!).';
    }

    return {
      headerText: '🕒 Select Time Slot',
      bodyText,
      buttonText: 'View Time Slots',
      interactiveType: 'list',
      sections,
      listRows: allRows,
    };
  }
}
