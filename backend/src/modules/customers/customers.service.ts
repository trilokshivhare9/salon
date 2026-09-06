import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

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
        user: {
          include: {
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
      appointments: salonUser.user.appointments,
      createdAt: salonUser.createdAt,
    };
  }
}
