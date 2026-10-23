import { Injectable, Logger } from '@nestjs/common';
import * as IndianFestivals from '@aryanjsx/indian-festivals';

// date-holidays exports CommonJS constructor directly
// eslint-disable-next-line @typescript-eslint/no-var-requires
const HolidaysModule = require('date-holidays');
const HolidaysConstructor = HolidaysModule?.default || HolidaysModule;

export interface CalendarHoliday {
  date: string; // YYYY-MM-DD
  name: string;
  festivalId?: string | null;
  icon: string;
  type: 'FESTIVAL' | 'NATIONAL' | 'REGIONAL' | 'HOLIDAY';
  religion: string;
  isPublicHoliday: boolean;
  description?: string;
  source: string;
}

@Injectable()
export class HolidaysProviderService {
  private readonly logger = new Logger(HolidaysProviderService.name);
  private readonly hd = new HolidaysConstructor('IN');

  /**
   * Determine suitable emoji icon based on holiday name & religious/cultural context
   */
  private getIcon(name: string, religion?: string): string {
    const lower = name.toLowerCase();
    if (lower.includes('diwali') || lower.includes('deepavali')) return '🪔';
    if (lower.includes('dhanteras')) return '🪙';
    if (lower.includes('dussehra') || lower.includes('vijayadashami')) return '🏹';
    if (lower.includes('durga puja') || lower.includes('navratri')) return '🌸';
    if (lower.includes('holi')) return '🎨';
    if (lower.includes('raksha bandhan')) return '🧵';
    if (lower.includes('janmashtami')) return '🪈';
    if (lower.includes('ganesh')) return '🐘';
    if (lower.includes('shivratri')) return '🔱';
    if (
      lower.includes('republic') ||
      lower.includes('independence') ||
      lower.includes('gandhi') ||
      lower.includes('unity') ||
      lower.includes('constitution') ||
      lower.includes('youth') ||
      lower.includes('army')
    ) {
      return '🇮🇳';
    }
    if (
      lower.includes('eid') ||
      lower.includes('muharram') ||
      lower.includes('ramadan') ||
      lower.includes('bakrid')
    ) {
      return '🌙';
    }
    if (
      lower.includes('christmas') ||
      lower.includes('easter') ||
      lower.includes('good friday') ||
      lower.includes('saints')
    ) {
      return '🎄';
    }
    if (
      lower.includes('guru') ||
      lower.includes('baisakhi') ||
      lower.includes('bandi') ||
      lower.includes('lohri')
    ) {
      return '🪯';
    }
    if (lower.includes('buddha') || lower.includes('dhammachakra')) return '☸️';
    if (
      lower.includes('mahavir') ||
      lower.includes('jain') ||
      lower.includes('paryushana')
    ) {
      return '🕊️';
    }
    if (lower.includes('karwa chauth')) return '🌙';
    if (lower.includes('chhath')) return '☀️';
    if (lower.includes('bhai dooj')) return '✨';
    if (lower.includes('govardhan')) return '🏔️';
    if (
      lower.includes('onam') ||
      lower.includes('pongal') ||
      lower.includes('makar sankranti')
    ) {
      return '🌾';
    }
    if (lower.includes('children')) return '🎈';
    if (religion === 'National') return '🇮🇳';
    if (religion === 'Hindu') return '🪔';
    if (religion === 'Islamic') return '🌙';
    if (religion === 'Christian') return '✝️';
    if (religion === 'Sikh') return '🪯';
    return '🎉';
  }

  /**
   * Retrieves authentic holidays and festivals for a given date range [startDate, endDate]
   * Powered by official @aryanjsx/indian-festivals and date-holidays dependencies.
   */
  getHolidaysForRange(startDate: string, endDate: string): CalendarHoliday[] {
    const result: CalendarHoliday[] = [];
    const seenKeys = new Set<string>();

    // 1. Official Indian Festivals dependency
    try {
      const list = IndianFestivals.getFestivalsInDateRange(startDate, endDate) || [];
      for (const item of list) {
        const key = `${item.date}::${item.name.toLowerCase()}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);

          let description: string | undefined;
          if (item.festivalId) {
            try {
              const fullDetails = IndianFestivals.getFestivalBySlug(item.festivalId);
              if (fullDetails?.description) {
                description = fullDetails.description;
              }
            } catch {
              // Ignore slug detail lookup failure
            }
          }

          result.push({
            date: item.date,
            name: item.name,
            festivalId: item.festivalId || null,
            icon: this.getIcon(item.name, item.religion),
            type: item.religion === 'National' ? 'NATIONAL' : 'FESTIVAL',
            religion: item.religion || 'General',
            isPublicHoliday: item.religion === 'National' || item.festivalId === 'diwali' || item.festivalId === 'holi',
            description,
            source: '@aryanjsx/indian-festivals',
          });
        }
      }
    } catch (err) {
      this.logger.warn(`Failed querying @aryanjsx/indian-festivals: ${err}`);
    }

    // 2. Official date-holidays dependency for India (covers gazetted public holidays across all years)
    try {
      const sYear = parseInt(startDate.slice(0, 4), 10);
      const eYear = parseInt(endDate.slice(0, 4), 10);
      for (let y = sYear; y <= eYear; y++) {
        const hols = this.hd.getHolidays(y) || [];
        for (const h of hols) {
          const dStr = typeof h.date === 'string' ? h.date.slice(0, 10) : '';
          if (dStr && dStr >= startDate && dStr <= endDate) {
            const key = `${dStr}::${h.name.toLowerCase()}`;
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              result.push({
                date: dStr,
                name: h.name,
                festivalId: null,
                icon: this.getIcon(h.name, 'National'),
                type: h.type === 'public' ? 'NATIONAL' : 'HOLIDAY',
                religion: 'National',
                isPublicHoliday: true,
                source: 'date-holidays',
              });
            }
          }
        }
      }
    } catch (err) {
      this.logger.warn(`Failed querying date-holidays: ${err}`);
    }

    result.sort((a, b) => a.date.localeCompare(b.date));
    return result;
  }

  /**
   * Convenience method to fetch holidays for a whole month
   * @param month 1-12
   * @param year 4-digit year (e.g. 2026)
   */
  getHolidaysForMonth(month: number, year: number): CalendarHoliday[] {
    const padMonth = String(month).padStart(2, '0');
    const startStr = `${year}-${padMonth}-01`;
    // Compute last day of month
    const lastDay = new Date(year, month, 0).getDate();
    const endStr = `${year}-${padMonth}-${String(lastDay).padStart(2, '0')}`;
    return this.getHolidaysForRange(startStr, endStr);
  }
}
