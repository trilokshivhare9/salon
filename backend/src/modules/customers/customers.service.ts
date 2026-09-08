import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';

@Injectable()
export class CustomersService {
  constructor(
    private prisma: PrismaService,
    @Inject(forwardRef(() => WhatsAppService))
    private whatsAppService: WhatsAppService,
  ) {}

  async getCustomers(
    salonId: string,
    search?: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const skip = (page - 1) * limit;
    const where: any = { salonId };

    if (search && search.trim().length > 0) {
      const term = search.trim();
      where.user = {
        OR: [
          { name: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term } },
        ],
      };
    }

    const [total, salonUsers] = await Promise.all([
      this.prisma.salonUser.count({ where }),
      this.prisma.salonUser.findMany({
        where,
        include: {
          user: true,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const formattedCustomers = salonUsers.map((su) => ({
      id: su.id,
      userId: su.userId,
      salonId: su.salonId,
      name: su.user.name || 'Unnamed Client',
      phone: su.user.phone,
      email: su.user.email,
      status: su.status,
      notes: su.notes,
      yearlyNoShowCount: su.yearlyNoShowCount,
      lastNoShowDate: su.lastNoShowDate,
      isBookingBlocked: su.isBookingBlocked,
      createdAt: su.createdAt,
    }));

    return {
      data: formattedCustomers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCustomerById(salonId: string, customerId: string) {
    const salonUser = await this.prisma.salonUser.findFirst({
      where: {
        salonId,
        OR: [{ id: customerId }, { userId: customerId }],
      },
      include: {
        user: true,
        appointments: {
          where: { salonId },
          include: {
            service: true,
            stylist: { select: { id: true, name: true } },
          },
          orderBy: { startAt: 'desc' },
          take: 20,
        },
      },
    });

    if (!salonUser) {
      throw new NotFoundException('Customer not found.');
    }

    return {
      id: salonUser.id,
      userId: salonUser.userId,
      salonId: salonUser.salonId,
      name: salonUser.user.name || 'Unnamed Client',
      phone: salonUser.user.phone,
      email: salonUser.user.email,
      status: salonUser.status,
      notes: salonUser.notes,
      yearlyNoShowCount: salonUser.yearlyNoShowCount,
      lastNoShowDate: salonUser.lastNoShowDate,
      isBookingBlocked: salonUser.isBookingBlocked,
      appointments: salonUser.appointments,
      createdAt: salonUser.createdAt,
    };
  }

  async unblockCustomer(salonId: string, customerId: string) {
    const salonUser = await this.prisma.salonUser.findFirst({
      where: {
        salonId,
        OR: [{ id: customerId }, { userId: customerId }],
      },
      include: {
        user: true,
        salon: {
          include: {
            whatsappAccount: true,
          },
        },
      },
    });

    if (!salonUser) {
      throw new NotFoundException('Customer not found.');
    }

    const updated = await this.prisma.salonUser.update({
      where: { id: salonUser.id },
      data: {
        yearlyNoShowCount: 0,
        isBookingBlocked: false,
      },
    });

    // Notify customer via WhatsApp that their account has been unblocked by the Salon Owner
    if (salonUser.user?.phone && salonUser.salon?.whatsappAccount?.phoneNumberId) {
      const message = `🎉 *ACCOUNT UNBLOCKED!*

Hi *${salonUser.user.name || 'Customer'}*, your appointment booking access has been restored by *${salonUser.salon.name}*!

You can now book appointment slots again anytime via WhatsApp.`;

      await this.whatsAppService.sendMetaMessage(
        salonUser.user.phone,
        {
          bodyText: message,
          interactiveType: 'button',
          buttons: [{ id: 'btn_start', title: '📅 Book Appointment' }],
        },
        salonUser.salon.whatsappAccount.phoneNumberId,
        salonId,
      ).catch(() => {});
    }

    return {
      message: 'Customer booking access unblocked successfully.',
      customer: {
        id: updated.id,
        userId: updated.userId,
        salonId: updated.salonId,
        yearlyNoShowCount: updated.yearlyNoShowCount,
        isBookingBlocked: updated.isBookingBlocked,
      },
    };
  }
}
