import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { DateTime } from 'luxon';
import { AppointmentStatus } from '@prisma/client';

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async getDashboardSummary(salonId: string, dateStr?: string) {
    const salon = await this.prisma.salon.findUnique({ where: { id: salonId } });
    const timezone = salon?.timezone || 'Asia/Kolkata';

    const targetDate = dateStr
      ? DateTime.fromISO(dateStr, { zone: timezone })
      : DateTime.now().setZone(timezone);

    const dateJs = targetDate.startOf('day').toJSDate();

    // 1. Appointments on target date
    const todayAppointments = await this.prisma.appointment.findMany({
      where: {
        salonId,
        date: dateJs,
      },
      include: {
        customer: true,
        staff: true,
        service: true,
      },
      orderBy: { startTime: 'asc' },
    });

    const statusCounts = {
      total: todayAppointments.length,
      confirmed: todayAppointments.filter((a) => a.status === AppointmentStatus.CONFIRMED).length,
      checkedIn: todayAppointments.filter((a) => a.status === AppointmentStatus.CHECKED_IN).length,
      inService: todayAppointments.filter((a) => a.status === AppointmentStatus.IN_SERVICE).length,
      completed: todayAppointments.filter((a) => a.status === AppointmentStatus.COMPLETED).length,
      cancelled: todayAppointments.filter((a) => a.status === AppointmentStatus.CANCELLED).length,
      noShow: todayAppointments.filter((a) => a.status === AppointmentStatus.NO_SHOW).length,
    };

    // Revenue calculation
    const todayRevenue = todayAppointments
      .filter((a) => a.status === AppointmentStatus.COMPLETED)
      .reduce((sum, a) => sum + Number(a.price), 0);

    // Source breakdown
    const sourceBreakdown = todayAppointments.reduce((acc, appt) => {
      acc[appt.source] = (acc[appt.source] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Total Salon Stats
    const [totalCustomers, totalStaff, totalServices] = await Promise.all([
      this.prisma.customer.count({ where: { salonId } }),
      this.prisma.staff.count({ where: { salonId, status: 'ACTIVE' } }),
      this.prisma.service.count({ where: { salonId, status: 'ACTIVE' } }),
    ]);

    return {
      date: targetDate.toISODate(),
      timezone,
      statusCounts,
      todayRevenue,
      sourceBreakdown,
      salonMetrics: {
        totalCustomers,
        totalActiveStaff: totalStaff,
        totalActiveServices: totalServices,
      },
      salon: {
        id: salon?.id,
        name: salon?.name,
        slug: salon?.slug,
        phone: salon?.phone,
      },
      todayAppointments,
    };
  }
}


