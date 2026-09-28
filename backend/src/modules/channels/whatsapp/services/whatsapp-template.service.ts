import { Injectable } from '@nestjs/common';
import { WhatsAppButtonId, InteractiveButton, InteractiveListRow } from './whatsapp-sender.service';
import { TimeUtility } from '../../../../common/utils/time.utility';

@Injectable()
export class WhatsAppTemplateService {
  // 1. Welcome & Active Hub Templates
  buildWelcomeMessage(salon: any, activeAppointment?: any) {
    const salonName = salon?.name || 'our Salon';

    if (activeAppointment) {
      const tz = salon?.timezone || TimeUtility.DEFAULT_TIMEZONE;
      const startTimeVal = activeAppointment.startTime || activeAppointment.startAt;
      const date = startTimeVal ? TimeUtility.formatDateFriendly(startTimeVal, tz, 'dd LLL, EEE') : '';
      const time = startTimeVal ? TimeUtility.formatTime12h(startTimeVal, tz) : '';
      return {
        bodyText: `👋 Welcome back to *${salonName}*!\n\n📋 *Active Reservation:*\n📅 ${date} at ${time}\n💈 Status: *${activeAppointment.status}*\n\nHow can we assist you today?`,
        interactiveType: 'button' as const,
        buttons: [
          { id: WhatsAppButtonId.ADD_SERVICE, title: '➕ Add Service' },
          { id: WhatsAppButtonId.RESCHEDULE, title: '🔄 Reschedule' },
          { id: WhatsAppButtonId.CANCEL_APPT, title: '✕ Cancel Booking' },
        ],
      };
    }

    return {
      bodyText: `👋 Welcome to *${salonName}*!\n\nBook your appointment in a few quick taps or explore our service catalog.`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.BOOK, title: '📅 Book Slot' },
        { id: WhatsAppButtonId.SERVICES, title: '✂️ View Services' },
        { id: WhatsAppButtonId.INFO, title: '📍 Salon Info' },
      ],
    };
  }

  // 2. Salon Info Template
  buildSalonInfoMessage(salon: any) {
    const name = salon?.name || 'Salon';
    const address = salon?.address || 'Address available at desk';
    const phone = salon?.phone || 'Contact desk directly';
    const hours = salon?.openingHours || '9:00 AM - 9:00 PM Daily';

    return {
      bodyText: `📍 *${name} Info*\n\n🏠 *Address:* ${address}\n📞 *Phone:* ${phone}\n🕒 *Hours:* ${hours}\n\nWe look forward to styling you!`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.BOOK, title: '📅 Book Slot' },
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
      ],
    };
  }

  // 3. Gender Selection Menu Template
  buildGenderSelectionMenu() {
    return {
      headerText: '💈 Choose Section',
      bodyText: 'Please select a gender section to view tailored services:',
      buttonText: 'Select Section',
      interactiveType: 'list' as const,
      listRows: [
        { id: 'gender_select_MALE', title: '👨 Men', description: 'Grooming & Haircuts for Gentlemen' },
        { id: 'gender_select_FEMALE', title: '👩 Women', description: 'Styling, Hair Care & Beauty Services' },
        { id: 'gender_select_KIDS', title: '👶 Kids', description: 'Gentle Haircuts for Children' },
        { id: 'gender_select_UNISEX', title: '✂️ Show All Services', description: 'View full menu across all sections' },
      ],
    };
  }

  // 4. Category Selection Menu Template
  buildCategoryMenu(categories: any[], genderLabel?: string) {
    const genderSuffix = genderLabel ? ` (${genderLabel})` : '';
    const rows: InteractiveListRow[] = categories.map((cat) => ({
      id: `cat_${cat.id}`,
      title: cat.name.slice(0, 24),
      description: cat.description ? cat.description.slice(0, 72) : undefined,
    }));

    rows.push({
      id: WhatsAppButtonId.SWITCH_GENDER,
      title: '🔄 Change Section',
      description: 'Switch between Men, Women, Kids & All Services',
    });

    return {
      headerText: `✂️ Categories${genderSuffix}`,
      bodyText: `Please choose a service category below:`,
      buttonText: 'View Categories',
      interactiveType: 'list' as const,
      listRows: rows,
    };
  }

  // 5. Service Selection Menu Template
  buildServiceMenu(services: any[], categoryName: string) {
    const rows: InteractiveListRow[] = services.map((svc) => ({
      id: `svc_${svc.id}`,
      title: svc.name.slice(0, 24),
      description: `⏱️ ${svc.durationMinutes || 30}m | ₹${svc.price || 0}`,
    }));

    rows.push({
      id: WhatsAppButtonId.CAT_BACK,
      title: '🔙 Back to Categories',
      description: 'Choose a different category',
    });

    return {
      headerText: `✂️ ${categoryName.slice(0, 20)}`,
      bodyText: `Select a service to book:`,
      buttonText: 'View Services',
      interactiveType: 'list' as const,
      listRows: rows,
    };
  }

  // 6. Staff Selection Menu Template
  buildStaffSelectionMenu(staffList: any[]) {
    const rows: InteractiveListRow[] = [
      {
        id: WhatsAppButtonId.STAFF_ANY,
        title: '✨ Any Specialist',
        description: 'Fastest available appointment slot',
      },
      ...staffList.map((st) => ({
        id: `staff_${st.id}`,
        title: st.name.slice(0, 24),
        description: st.role ? st.role.slice(0, 72) : 'Specialist',
      })),
    ];

    return {
      headerText: '💇‍♂️ Choose Specialist',
      bodyText: 'Select your preferred stylist or pick Any Specialist:',
      buttonText: 'Select Specialist',
      interactiveType: 'list' as const,
      listRows: rows,
    };
  }

  // 7. Date Selection Menu Template
  buildDateSelectionMenu(dates: { dateStr: string; displayLabel: string }[], isReschedule = false) {
    const prefix = isReschedule ? 'rdate_' : 'date_';
    const buttons: InteractiveButton[] = dates.slice(0, 2).map((d) => ({
      id: `${prefix}${d.dateStr}`,
      title: d.displayLabel.slice(0, 20),
    }));

    buttons.push({ id: WhatsAppButtonId.START, title: '🏠 Main Menu' });

    return {
      bodyText: isReschedule
        ? `🔄 *Select New Date*\n\nPlease choose a new date for your appointment:`
        : `📅 *Select Appointment Date*\n\nPlease choose a date:`,
      interactiveType: 'button' as const,
      buttons,
    };
  }

  // 8. Time Slot Menu Template
  buildTimeSlotMenu(slots: { timeStr: string; displayTime: string }[], isReschedule = false) {
    const prefix = isReschedule ? 'rslot_' : 'slot_';
    const rows: InteractiveListRow[] = slots.slice(0, 10).map((s) => ({
      id: `${prefix}${s.timeStr}`,
      title: s.displayTime,
      description: 'Available Slot',
    }));

    return {
      headerText: '🕒 Select Time Slot',
      bodyText: 'Please pick an available time slot:',
      buttonText: 'View Time Slots',
      interactiveType: 'list' as const,
      listRows: rows,
    };
  }

  // 9. Booking Confirmation Prompt Template
  buildBookingConfirmationPrompt(summary: {
    serviceName: string;
    staffName: string;
    dateStr: string;
    timeStr: string;
    price: number;
  }) {
    return {
      bodyText: `📋 *Booking Confirmation*\n\n✂️ *Service:* ${summary.serviceName}\n💇‍♂️ *Stylist:* ${summary.staffName}\n📅 *Date:* ${summary.dateStr}\n🕒 *Time:* ${summary.timeStr}\n💵 *Price:* ₹${summary.price}\n\nWould you like to confirm this reservation?`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.CONFIRM_YES, title: '✅ Confirm Booking' },
        { id: WhatsAppButtonId.START, title: '✕ Cancel' },
      ],
    };
  }

  // 10. Booking Success Reply Template
  buildBookingSuccessReply(appointment: any, timezone?: string) {
    const tz = timezone || TimeUtility.DEFAULT_TIMEZONE;
    const startTimeVal = appointment?.startTime || appointment?.startAt;
    const date = startTimeVal ? TimeUtility.formatDateFriendly(startTimeVal, tz, 'dd LLL, EEE') : '';
    const time = startTimeVal ? TimeUtility.formatTime12h(startTimeVal, tz) : '';

    return {
      bodyText: `🎉 *Booking Confirmed!*\n\nYour appointment has been successfully scheduled.\n\n📅 *Date:* ${date}\n🕒 *Time:* ${time}\n\nWe look forward to serving you!`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.BOOK, title: '📋 Active Booking' },
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
      ],
    };
  }

  // 11. Cancellation Templates
  buildCancelConfirmationPrompt(strikeWarning: boolean) {
    if (strikeWarning) {
      return {
        bodyText: `⚠️ *Cancellation Warning*\n\nCancelling within 2 hours of your appointment will result in a *Penalty Strike*.\n\nAre you sure you want to cancel?`,
        interactiveType: 'button' as const,
        buttons: [
          { id: WhatsAppButtonId.CANCEL_YES, title: '⚠️ Cancel (1 Strike)' },
          { id: WhatsAppButtonId.CANCEL_NO, title: '🔙 Keep Appointment' },
        ],
      };
    }

    return {
      bodyText: `❓ Are you sure you want to cancel your reservation?`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.CANCEL_YES, title: '✅ Yes, Cancel' },
        { id: WhatsAppButtonId.CANCEL_NO, title: '🔙 Keep Appointment' },
      ],
    };
  }

  buildCancelSuccessReply() {
    return {
      bodyText: `✅ *Appointment Cancelled*\n\nYour reservation has been cancelled and your slot released. We hope to see you again soon!`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.BOOK, title: '📅 Book New Slot' },
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
      ],
    };
  }

  buildCancelKeepReply() {
    return {
      bodyText: `👍 *Your appointment remains confirmed!* See you at your scheduled time.`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  // 12. Check-In / ETA Templates
  buildCheckinSuccessReply() {
    return {
      bodyText: `✅ *Checked In Successfully!*\n\nOur staff has been notified of your arrival. Please have a seat in the waiting section!`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  buildLateNotificationReply(minutes: number) {
    return {
      bodyText: `⏱️ *Duly Noted!*\n\nWe have updated your status and informed your stylist that you will be arriving ~${minutes} mins late.`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  // 13. Reschedule Templates
  buildReschedulePrompt() {
    return {
      bodyText: `📅 *Reschedule Appointment*\n\nPlease choose a new date for your visit:`,
      interactiveType: 'button' as const,
      buttons: [
        { id: 'rdate_today', title: 'Today' },
        { id: 'rdate_tmrw', title: 'Tomorrow' },
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
      ],
    };
  }

  buildRescheduleSuccessReply(newDateStr: string, newTimeStr: string) {
    return {
      bodyText: `🎉 *Appointment Rescheduled!*\n\nYour reservation is now set for *${newDateStr} at ${newTimeStr}*. See you soon!`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  // 14. Quick Booking Templates
  buildQuickBookCategoryMenu(categories: any[]) {
    return {
      headerText: '⚡ Quick Booking',
      bodyText: `⚡ *IN-SALON QUICK BOOKING*\n\nWelcome! Please choose a service category below:`,
      buttonText: 'View Categories',
      interactiveType: 'list' as const,
      listRows: categories.map((cat) => ({
        id: `cat_${cat.id}`,
        title: cat.name.slice(0, 24),
        description: cat.description ? cat.description.slice(0, 72) : undefined,
      })),
    };
  }

  buildQuickBookConfirmationPrompt(details: {
    salonName: string;
    serviceName: string;
    price: number;
    duration: number;
    dateFormatted: string;
    timeFormatted: string;
    stylistName?: string;
  }) {
    return {
      headerText: '⚡ Quick Booking Confirmation',
      bodyText:
        `⚡ *QUICK BOOKING DETAILS*\n\n` +
        `• *Salon:* *${details.salonName}*\n` +
        `• *Service:* *${details.serviceName}*\n` +
        `• *Duration:* ${details.duration} mins\n` +
        `• *Price:* ₹${details.price}\n` +
        `• *Earliest Slot Today:* ${details.dateFormatted} at *${details.timeFormatted}*\n` +
        `• *Specialist:* *${details.stylistName || 'First Available Specialist'}*\n\n` +
        `Tap *⚡ Confirm Quick Book* below to submit your check-in request to the salon desk.`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.CONFIRM_QUICK, title: '⚡ Confirm Quick Book' },
        { id: WhatsAppButtonId.SERVICES, title: '✂️ Other Service' },
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
      ],
    };
  }

  buildQuickBookPendingReply(appointment: any) {
    return {
      bodyText: `⏳ *REQUEST SENT TO SALON!*\n\nYour quick booking request for *${appointment?.serviceNameSnapshot || 'Service'}* is *Pending Approval* by the salon desk. We will notify you once confirmed!`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.BOOK, title: '📋 Check Status' },
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
      ],
    };
  }

  // 15. Expired Action Template
  buildExpiredActionReply(isPostBooking: boolean) {
    if (isPostBooking) {
      return {
        bodyText: `⚠️ This option has expired. You can check your last booking or start a new one.`,
        interactiveType: 'button' as const,
        buttons: [
          { id: WhatsAppButtonId.BOOK, title: '📋 Check Last Booking' },
          { id: WhatsAppButtonId.START, title: '📅 New Booking' },
        ],
      };
    }

    return {
      bodyText: `⚠️ Expired option. Would you like to continue your current booking or start a new one?`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.BOOK, title: '▶️ Continue Booking' },
        { id: WhatsAppButtonId.START, title: '📅 New Booking' },
      ],
    };
  }

  // 16. Reminder & Penalty Templates
  build2HourReminderPrompt(
    salonName: string,
    userName: string,
    serviceName: string,
    price: number,
    stylistName: string,
    dateStr: string,
    timeStr: string,
    salonAddress: string,
  ) {
    return {
      bodyText: `⏰ *APPOINTMENT REMINDER*\n\nHello *${userName || 'Customer'}*, your upcoming visit at *${salonName}* is in ~2 hours:\n\n• *Service:* *${serviceName}* (₹${price})\n• *Stylist:* *${stylistName}*\n• *Date:* *${dateStr}*\n• *Time:* *${timeStr}*\n\n📍 *${salonName}*\n${salonAddress || ''}\n\nPlease confirm your arrival so we keep your chair ready!`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.REMIND_CONFIRM, title: "✅ I'll Be There" },
        { id: WhatsAppButtonId.REMIND_RESCHEDULE, title: '🔄 Reschedule' },
        { id: WhatsAppButtonId.REMIND_CANCEL, title: '❌ Cancel' },
      ],
    };
  }

  build15MinArrivalPrompt(
    salonName: string,
    userName: string,
    stylistName: string,
    timeStr: string,
  ) {
    return {
      bodyText: `🚨 *URGENT: ARRIVAL CHECK-IN REQUIRED*\n\nHi *${userName || 'Customer'}*, your appointment at *${salonName}* with *${stylistName}* starts in ~15 mins (*${timeStr}*).\n\n⚠️ *Arrival Notice:* We hold your chair strictly for 5 minutes after start time before automatic slot cancellation.\n\nPlease update your status below:`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.ETA_ARRIVED, title: "📍 I'm Arrived" },
        { id: WhatsAppButtonId.ETA_ON_THE_WAY, title: '🚗 On My Way' },
        { id: WhatsAppButtonId.ETA_CANCEL, title: '❌ Cancel Visit' },
      ],
    };
  }

  buildPenaltyStrikePrompt(
    userName: string,
    timeStr: string,
    stylistName: string,
    remainingPenalties: number,
  ) {
    return {
      bodyText: `⚠️ *LATE CANCELLATION / NO-SHOW PENALTY RECORDED*\n\nHi *${userName || 'Customer'}*, your appointment for *${timeStr}* with *${stylistName}* was canceled with less than 2 hours remaining.\n\n⚠️ *Penalty Strike Recorded:* You have *1 penalty strike* recorded. You have *${remainingPenalties} penalty strike(s) remaining* this year before automatic slot booking is locked.`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  buildAccountLockedPrompt(userName: string) {
    return {
      bodyText: `⚠️ *ACCOUNT BOOKING LOCKED*\n\nHi *${userName || 'Customer'}*, you have accumulated *3 penalty strikes* this year for missed or late-canceled appointments. Automatic slot booking is now locked for your account.\n\n📞 *Please contact the Salon Owner* directly to request access unblock.`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }
}
