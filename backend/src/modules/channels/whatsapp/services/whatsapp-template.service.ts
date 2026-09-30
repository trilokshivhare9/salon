import { Injectable } from '@nestjs/common';
import { WhatsAppButtonId, InteractiveButton, InteractiveListRow, InteractiveListSection } from './whatsapp-sender.service';
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
      bodyText: `👋 Welcome to *${salonName}*!\n\nBook your appointment in a few quick taps or choose Quick Book for express walk-in check-in.`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.BOOK, title: '📅 Book Slot' },
        { id: WhatsAppButtonId.QUICK_BOOK, title: '⚡ Quick Book' },
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

  // 5.1 Streamlined Multi-Section Service Menu (1-Tap Service Selection)
  buildSectionedServiceMenu(salon: any, genderLabel?: string) {
    const categories: any[] = salon.serviceCategories || [];
    const allServices: any[] = salon.services || [];
    const genderSuffix = genderLabel && genderLabel !== 'UNISEX' ? ` (${genderLabel})` : '';

    const sections: InteractiveListSection[] = [];
    let rowCount = 0;
    const MAX_ROWS = 9; // Leave room for "All Categories" if catalog is large

    for (const cat of categories) {
      if (rowCount >= MAX_ROWS) break;

      const catServices = allServices.filter((s: any) => {
        const inCat = (s.categoryId || s.serviceCategoryId) === cat.id;
        if (!inCat) return false;
        if (!genderLabel || genderLabel === 'UNISEX') return true;
        const g = s.targetGender || s.gender;
        return g === genderLabel || g === 'UNISEX' || !g;
      });

      if (catServices.length === 0) continue;

      const rows: InteractiveListRow[] = [];
      for (const svc of catServices) {
        if (rowCount >= MAX_ROWS) break;
        rows.push({
          id: `qsvc_${svc.id}`,
          title: svc.name.slice(0, 24),
          description: `⏱️ ${svc.durationMinutes || 30}m | ₹${svc.price || 0}`.slice(0, 72),
        });
        rowCount++;
      }

      if (rows.length > 0) {
        sections.push({
          title: cat.name.slice(0, 24),
          rows,
        });
      }
    }

    // Uncategorized services fallback
    if (rowCount < MAX_ROWS) {
      const uncategorized = allServices.filter(
        (s: any) => !s.categoryId && !s.serviceCategoryId,
      );
      if (uncategorized.length > 0) {
        const uncatRows: InteractiveListRow[] = [];
        for (const svc of uncategorized) {
          if (rowCount >= MAX_ROWS) break;
          uncatRows.push({
            id: `qsvc_${svc.id}`,
            title: svc.name.slice(0, 24),
            description: `⏱️ ${svc.durationMinutes || 30}m | ₹${svc.price || 0}`.slice(0, 72),
          });
          rowCount++;
        }
        if (uncatRows.length > 0) {
          sections.push({
            title: 'Other Services',
            rows: uncatRows,
          });
        }
      }
    }

    // If salon has many services (> 9), append "All Categories" row
    if (allServices.length > MAX_ROWS && sections.length > 0) {
      sections[sections.length - 1].rows.push({
        id: 'btn_all_categories',
        title: '📂 All Categories',
        description: 'Explore full categorized menu',
      });
    }

    // If no sections were built (e.g. empty categories), fallback to flat list
    if (sections.length === 0) {
      const flatRows: InteractiveListRow[] = allServices.slice(0, 10).map((s: any) => ({
        id: `qsvc_${s.id}`,
        title: s.name.slice(0, 24),
        description: `⏱️ ${s.durationMinutes || 30}m | ₹${s.price || 0}`.slice(0, 72),
      }));
      return {
        headerText: `✂️ ${salon.name || 'Salon'}${genderSuffix}`.slice(0, 60),
        bodyText: `Please choose a service to book your appointment:`,
        buttonText: 'Select Service',
        interactiveType: 'list' as const,
        listRows: flatRows,
      };
    }

    return {
      headerText: `✂️ ${salon.name || 'Salon'}${genderSuffix}`.slice(0, 60),
      bodyText: `Please choose a service to book your appointment:`,
      buttonText: 'Select Service',
      interactiveType: 'list' as const,
      listSections: sections,
    };
  }

  // 5.2 Direct Quick Slot Menu (1-Tap Slot Selection)
  buildDirectQuickSlotMenu(params: {
    serviceName: string;
    price: number;
    durationMinutes: number;
    serviceId: string;
    slots: {
      dateStr: string;
      displayDate: string;
      startTime: string;
      displayTime: string;
      staffId?: string;
      staffName?: string;
    }[];
  }) {
    const rows: InteractiveListRow[] = params.slots.slice(0, 8).map((s) => ({
      id: `qslot_${s.dateStr}_${s.startTime}_${s.staffId || 'any'}`,
      title: `${s.displayDate}, ${s.displayTime}`.slice(0, 24),
      description: `⏱️ ${params.durationMinutes}m • ${s.staffName || 'Any Specialist'}`.slice(0, 72),
    }));

    // Customization rows: pick specialist or pick other date
    rows.push({
      id: `btn_pick_stylist_${params.serviceId}`,
      title: '💇 Pick Specialist',
      description: 'Choose a specific stylist instead',
    });

    rows.push({
      id: `btn_pick_custom_date_${params.serviceId}`,
      title: '📅 Pick Other Date',
      description: 'View upcoming calendar dates',
    });

    return {
      headerText: `📅 Instant Slots`.slice(0, 60),
      bodyText: `Selected: *${params.serviceName}* (₹${params.price})\n\nChoose your preferred time slot below:`,
      buttonText: 'Choose Time',
      interactiveType: 'list' as const,
      listRows: rows,
    };
  }

  // 5.3 Native WhatsApp Booking Flow Message (1-Screen Flow Form)
  buildBookingFlowMessage(params: {
    salon: any;
    flowId: string;
    flowToken: string;
    mode?: 'draft' | 'published';
  }) {
    const { salon, flowId, flowToken, mode = 'draft' } = params;
    const services = (salon.services || []).filter((s: any) => s.status === 'ACTIVE').slice(0, 10).map((s: any) => ({
      id: s.id,
      title: s.name.slice(0, 24),
      description: `${s.durationMinutes || 30} mins • ₹${s.price || 0}`.slice(0, 72),
    }));

    const stylists = [
      { id: 'any', title: '✨ Any Specialist' },
      ...(salon.stylists || []).filter((st: any) => st.status === 'ACTIVE').slice(0, 9).map((st: any) => ({
        id: st.id,
        title: st.name.slice(0, 24),
      })),
    ];

    const tz = salon.timezone || TimeUtility.DEFAULT_TIMEZONE;
    const now = TimeUtility.now(tz);
    const dates = [
      { id: now.toISODate()!, title: `Today (${now.toFormat('dd LLL')})` },
      { id: now.plus({ days: 1 }).toISODate()!, title: `Tomorrow (${now.plus({ days: 1 }).toFormat('dd LLL')})` },
      { id: now.plus({ days: 2 }).toISODate()!, title: now.plus({ days: 2 }).toFormat('EEE, dd LLL') },
      { id: now.plus({ days: 3 }).toISODate()!, title: now.plus({ days: 3 }).toFormat('EEE, dd LLL') },
    ];

    const slots = [
      { id: '10:00', title: '10:00 AM' },
      { id: '10:30', title: '10:30 AM' },
      { id: '11:00', title: '11:00 AM' },
      { id: '11:30', title: '11:30 AM' },
      { id: '12:00', title: '12:00 PM' },
      { id: '14:00', title: '02:00 PM' },
      { id: '15:00', title: '03:00 PM' },
      { id: '16:00', title: '04:00 PM' },
      { id: '17:00', title: '05:00 PM' },
      { id: '18:00', title: '06:00 PM' },
    ];

    return {
      interactiveType: 'flow' as const,
      headerText: `✂️ ${salon.name || 'Salon'}`.slice(0, 60),
      bodyText: `Welcome to *${salon.name || 'our Salon'}*!\n\nTap below to open our native appointment booking form:`,
      footerText: 'Powered by Salon SaaS',
      buttonText: '📅 Book Slot',
      flowId,
      flowCta: '📅 Book Slot',
      flowToken,
      flowMode: mode,
      flowActionPayload: {
        screen: 'BOOKING_SCREEN',
        data: {
          services: services.length > 0 ? services : [{ id: 'general', title: 'General Service', description: '30m' }],
          stylists,
          dates,
          slots,
        },
      },
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
    const svcName = appointment?.service?.name ? `\n✂️ *Service:* ${appointment.service.name}` : '';
    const apptNum = appointment?.appointmentNumber ? `\n🔖 *Ref:* ${appointment.appointmentNumber}` : '';

    return {
      bodyText: `🎉 *Booking Confirmed!*\n\nYour appointment has been successfully scheduled.${svcName}\n📅 *Date:* ${date}\n🕒 *Time:* ${time}${apptNum}\n\nWe look forward to serving you!`,
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
        bodyText: `⚠️ *Cancellation Warning*\n\nCancelling with less than 90 minutes remaining before your appointment will result in a *Penalty Strike*.\n\nAre you sure you want to cancel?`,
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
          { id: WhatsAppButtonId.RESUME_BOOKING, title: '📋 Check Last Booking' },
          { id: WhatsAppButtonId.NEW_BOOKING, title: '📅 New Booking' },
        ],
      };
    }

    return {
      bodyText: `⚠️ Expired option. You tapped an older action from chat history.\n\nWould you like to continue your current booking or start a new one?`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.RESUME_BOOKING, title: '▶️ Continue Booking' },
        { id: WhatsAppButtonId.NEW_BOOKING, title: '📅 New Booking' },
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
      bodyText: `⏰ *APPOINTMENT REMINDER*\n\nHello *${userName || 'Customer'}*, your upcoming visit at *${salonName}* is in ~2 hours:\n\n• *Service:* *${serviceName}* (₹${price})\n• *Stylist:* *${stylistName}*\n• *Date:* *${dateStr}*\n• *Time:* *${timeStr}*\n\n📍 *${salonName}*\n${salonAddress || ''}\n\n⚠️ *Action Required within 1 Hour:*\nPlease tap *Confirm Booking* below. If not confirmed at least 1 hour before your slot, the appointment will be *automatically canceled with a penalty strike* to release the slot for other waiting clients.`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.REMIND_CONFIRM, title: '✅ Confirm Booking' },
        { id: WhatsAppButtonId.REMIND_RESCHEDULE, title: '🔄 Reschedule' },
        { id: WhatsAppButtonId.REMIND_CANCEL, title: '❌ Cancel' },
      ],
    };
  }

  buildAppointmentAlreadyCanceledReply(params: {
    timeStr?: string;
    dateStr?: string;
    isAutoCanceled?: boolean;
  }) {
    const timeDetail = params.timeStr ? ` for *${params.timeStr}*` : '';
    const dateDetail = params.dateStr ? ` on *${params.dateStr}*` : '';
    const reasonText = params.isAutoCanceled
      ? `This appointment was *automatically canceled* because confirmation was not received 1 hour prior to your slot, and the slot was released.`
      : `This appointment has already been *canceled*.`;

    return {
      bodyText: `⚠️ *APPOINTMENT ALREADY CANCELED*\n\nYour appointment${timeDetail}${dateDetail} can no longer be modified or confirmed.\n\n${reasonText}\n\nWould you like to book a fresh appointment?`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.BOOK_NOW, title: '📅 Book New Slot' },
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
      ],
    };
  }

  buildAppointmentAlreadyCompletedReply(params: {
    serviceName?: string;
    dateStr?: string;
  }) {
    const svcText = params.serviceName ? ` for *${params.serviceName}*` : '';
    return {
      bodyText: `✨ *VISIT COMPLETED*\n\nYour appointment${svcText} has already been completed. Thank you for visiting us! 🙏\n\nReady for your next styling session?`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.BOOK_NOW, title: '📅 Book Again' },
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
      ],
    };
  }

  buildAppointmentAlreadyConfirmedReply(params: {
    timeStr?: string;
    stylistName?: string;
  }) {
    return {
      bodyText: `✅ *APPOINTMENT ALREADY CONFIRMED*\n\nYour visit${params.timeStr ? ` at *${params.timeStr}*` : ''}${params.stylistName ? ` with *${params.stylistName}*` : ''} is confirmed! We look forward to seeing you. 💇`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
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
      bodyText: `⚠️ *LATE CANCELLATION / NO-SHOW PENALTY RECORDED*\n\nHi *${userName || 'Customer'}*, your appointment for *${timeStr}* with *${stylistName}* was canceled with less than 90 minutes remaining.\n\n⚠️ *Penalty Strike Recorded:* You have *1 penalty strike* recorded. You have *${remainingPenalties} penalty strike(s) remaining* this year before automatic slot booking is locked.`,
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

  // 17. Reschedule Flow Templates
  buildRescheduleProposalPrompt(params: {
    salonName: string;
    customerName: string;
    dateFriendly: string;
    timeFriendly: string;
    stylistName: string;
    appointmentId: string;
  }) {
    return {
      bodyText:
        `📅 *RESCHEDULE REQUEST FROM SALON*\n\n` +
        `Hi *${params.customerName || 'Customer'}*, *${params.salonName}* has requested to reschedule your appointment to:\n\n` +
        `• *Date:* *${params.dateFriendly}*\n` +
        `• *Time:* *${params.timeFriendly}*\n` +
        `• *Stylist:* *${params.stylistName || 'Specialist'}*\n\n` +
        `Does this new time work for you?`,
      interactiveType: 'button' as const,
      buttons: [
        { id: `${WhatsAppButtonId.PROPOSE_ACCEPT_PREFIX}${params.appointmentId}`, title: '✅ Accept New Time' },
        { id: `${WhatsAppButtonId.PROPOSE_DECLINE_PREFIX}${params.appointmentId}`, title: '❌ Decline & Cancel' },
      ],
    };
  }

  buildRescheduleAcceptedReply(params: {
    salonName: string;
    stylistName: string;
    newTimeStr: string;
  }) {
    return {
      bodyText: `🎉 *RESCHEDULE CONFIRMED!*\n\nThank you for accepting! Your appointment with *${params.stylistName || 'Stylist'}* at *${params.salonName}* is now set for *${params.newTimeStr}*.`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  buildRescheduleDeclinedReply() {
    return {
      bodyText: `❌ *APPOINTMENT CANCELLED*\n\nYour appointment has been cancelled as you declined the rescheduled time. *No penalty* has been applied to your account.\n\nFeel free to book a new appointment whenever you are ready!`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.BOOK_NOW, title: '📅 Book New Slot' },
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
      ],
    };
  }

  // 18. Cancellation Notice Templates
  buildAdminCancelledNotice(params: {
    userName: string;
    dateStr: string;
    timeStr: string;
    salonName: string;
    penaltyApplied: boolean;
    remainingStrikes?: number;
    isBlocked?: boolean;
  }) {
    if (!params.penaltyApplied) {
      return {
        bodyText: `🙏 *APPOINTMENT CANCELLED*\n\nHi *${params.userName || 'Customer'}*, your appointment for *${params.dateStr} at ${params.timeStr}* at *${params.salonName}* has been cancelled.\n\n✨ *No penalty has been applied* to your account. We look forward to seeing you again soon!`,
        interactiveType: 'button' as const,
        buttons: [{ id: WhatsAppButtonId.BOOK, title: '📅 Book New Visit' }],
      };
    }

    if (params.isBlocked) {
      return {
        bodyText: `⚠️ *ACCOUNT BOOKING LOCKED*\n\nHi *${params.userName || 'Customer'}*, you have accumulated *3 penalty strikes* this year for missed or late-canceled appointments. Automatic slot booking is now locked for your account.\n\n📞 *Please contact the Salon Owner* directly to request access unblock.`,
        interactiveType: 'button' as const,
        buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
      };
    }

    return {
      bodyText: `⚠️ *LATE CANCELLATION PENALTY RECORDED*\n\nHi *${params.userName || 'Customer'}*, your appointment for *${params.timeStr}* at *${params.salonName}* was canceled with a penalty strike recorded by the salon.\n\n⚠️ *Penalty Strike Recorded:* You have *${params.remainingStrikes ?? 2} penalty strike(s) remaining* this year before automatic slot booking is locked.`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  buildSystemAutoCutoffNotice(params: {
    userName: string;
    timeStr: string;
    remainingStrikes: number;
    isBlocked: boolean;
  }) {
    if (params.isBlocked) {
      return {
        bodyText: `⚠️ *ACCOUNT BOOKING LOCKED*\n\nHi *${params.userName || 'Customer'}*, you have accumulated *3 penalty strikes* this year for unconfirmed appointments. Automatic slot booking is now locked for your account.\n\n📞 *Please contact the Salon Owner* directly to request access unblock.`,
        interactiveType: 'button' as const,
        buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
      };
    }
    return {
      bodyText: `⚠️ *APPOINTMENT AUTO-CANCELED (NO CONFIRMATION)*\n\nHi *${params.userName || 'Customer'}*, your appointment for *${params.timeStr}* was auto-canceled because confirmation was not received 1 hour prior to your slot.\n\n⚠️ *Penalty Strike Recorded:* You have *${params.remainingStrikes} strike(s) remaining* this year before automatic slot booking is locked.`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  buildSystemAutoNoShowNotice(params: {
    userName: string;
    timeStr: string;
    remainingStrikes: number;
    isBlocked: boolean;
  }) {
    if (params.isBlocked) {
      return {
        bodyText: `⚠️ *ACCOUNT BOOKING LOCKED*\n\nHi *${params.userName || 'Customer'}*, you have accumulated *3 penalty strikes* this year for missed appointments. Automatic slot booking is now locked for your account.\n\n📞 *Please contact the Salon Owner* directly to request access unblock.`,
        interactiveType: 'button' as const,
        buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
      };
    }
    return {
      bodyText: `⚠️ *APPOINTMENT AUTO-CANCELED*\n\nHi *${params.userName || 'Customer'}*, your appointment for *${params.timeStr}* was auto-canceled because we did not receive an arrival confirmation.\n\n⚠️ *Penalty Strike Recorded:* You have *${params.remainingStrikes} strike(s) remaining* this year before automatic slot booking is locked.`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  buildQuickBookingExpiredNotice(params: { salonName: string; timeStr: string }) {
    return {
      bodyText: `⏳ *QUICK BOOKING EXPIRED*\n\nYour quick booking request for *${params.timeStr}* at *${params.salonName}* was not checked in before the start time and has automatically expired.\n\nPlease speak to the front desk for walk-in availability. 🙏`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  buildSalonDeactivationNotice(params: {
    userName: string;
    salonName: string;
    dateStr: string;
    timeStr: string;
  }) {
    return {
      bodyText: `⚠️ *APPOINTMENT CANCELLED*\n\nHi *${params.userName || 'Customer'}*, your appointment for *${params.dateStr} at ${params.timeStr}* at *${params.salonName}* has been cancelled because the salon account was temporarily deactivated for platform maintenance.\n\nWe apologize for any inconvenience. Please contact the salon directly or visit another location for bookings.`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  buildSalonClosureNotice(params: { userName: string; salonName: string; timeStr: string }) {
    return {
      bodyText: `🙏 *SALON NOTICE: APPOINTMENT CANCELED*\n\nHi *${params.userName || 'Customer'}*, your appointment for *${params.timeStr}* at *${params.salonName}* was canceled due to a salon emergency.\n\n✨ *No penalty has been applied* to your account. We welcome you to rebook at your convenience!`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.BOOK, title: '📅 Book New Visit' }],
    };
  }

  buildRescheduleCutoffPassedPrompt(salonPhone?: string) {
    const contactLine = salonPhone ? `\n\n• For urgent desk adjustments, call *${salonPhone}*.` : '';
    return {
      bodyText: `⚠️ *Reschedule Cutoff Passed*\n\nRescheduling is only permitted up to 90 minutes before your appointment. You cannot reschedule because the time cutoff has passed.\n\nYou may attend your visit or cancel this booking if you cannot make it.${contactLine}`,
      interactiveType: 'button' as const,
      buttons: [
        { id: WhatsAppButtonId.CANCEL_APPT, title: '❌ Cancel Booking' },
        { id: WhatsAppButtonId.ETA_ON_THE_WAY, title: '🚗 On My Way' },
        { id: WhatsAppButtonId.START, title: '🏠 Main Menu' },
      ],
    };
  }

  buildRescheduleExpiredNotice(params: { salonName: string; proposedTimeStr: string }) {
    return {
      bodyText: `⚠️ *Reschedule Offer Expired*\n\nYour proposed appointment reschedule at *${params.salonName}* for *${params.proposedTimeStr}* has expired because we did not receive a response before the response cutoff.\n\nTo ensure staff availability, your appointment has been cancelled. *No penalty was applied.* We apologize for the inconvenience and look forward to serving you soon!`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }

  buildRescheduleStaleExpiredReply() {
    return {
      bodyText: `⚠️ *Offer No Longer Available*\n\nThis reschedule proposal has expired as the response cutoff passed, and the slot was released. Your booking was cancelled with zero penalty.\n\nPlease tap below to return to the main menu.`,
      interactiveType: 'button' as const,
      buttons: [{ id: WhatsAppButtonId.START, title: '🏠 Main Menu' }],
    };
  }
}
