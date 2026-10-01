import { ServiceGender } from '@prisma/client';
import { TimeUtility } from '../../../../../common/utils/time.utility';

export class ActionUtils {
  /**
   * Standard draft reset object to clear in-flight booking state
   */
  static getClearDraftData() {
    return {
      selectedCategoryId: null,
      selectedServiceId: null,
      selectedStaffId: null,
      selectedDate: null,
      selectedStartTime: null,
      quickCodeVerifiedAt: null,
    };
  }

  /**
   * Filters service categories based on active customer gender selection
   */
  static filterCategoriesByGender(categories: any[], services: any[], gender?: ServiceGender | null): any[] {
    if (!categories || categories.length === 0) return [];
    if (!gender || gender === 'UNISEX') return categories;

    return categories.filter((cat: any) => {
      return (services || []).some(
        (s: any) =>
          (s.categoryId || s.serviceCategoryId) === cat.id &&
          ((s.targetGender || s.gender) === gender || (s.targetGender || s.gender) === 'UNISEX'),
      );
    });
  }

  /**
   * Filters services in a category matching target gender
   */
  static filterCategoryServices(
    services: any[],
    categoryId: string,
    gender?: ServiceGender | null,
  ): any[] {
    return (services || []).filter((s: any) => {
      const inCat =
        (s.categoryId || s.serviceCategoryId) === categoryId ||
        (categoryId === 'uncategorized' && !s.categoryId && !s.serviceCategoryId);
      if (!inCat) return false;
      if (!gender || gender === 'UNISEX') return true;
      return (s.targetGender || s.gender) === gender || (s.targetGender || s.gender) === 'UNISEX';
    });
  }

  /**
   * Checks whether user record has a legitimate non-placeholder name
   */
  static hasRealName(user: any): boolean {
    if (!user?.name) return false;
    const trimmed = user.name.trim();
    if (trimmed.length < 2) return false;
    const genericPlaceholders = ['WhatsApp Customer', 'Customer', 'Valued Client', 'Valued Customer'];
    return !genericPlaceholders.includes(trimmed);
  }

  /**
   * Formats time to 12h representation
   */
  static formatTime12h(timeStr: string | Date | number | null | undefined, zone?: string): string {
    return TimeUtility.formatTime12h(timeStr, zone);
  }

  /**
   * Formats date to friendly representation (e.g. 15 Oct, Wednesday)
   */
  static formatDateFriendly(date: string | Date, zone?: string, formatStr?: string): string {
    return TimeUtility.formatDateFriendly(date, zone, formatStr);
  }
}
