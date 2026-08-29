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
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term } },
      ];
    }

    const [total, customers] = await Promise.all([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: { lastVisitAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    return {
      data: customers,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getCustomerById(salonId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, salonId },
      include: {
        appointments: {
          include: {
            service: true,
            staff: { select: { id: true, name: true } },
          },
          orderBy: { startTime: 'desc' },
          take: 20,
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Customer not found.');
    }

    return customer;
  }
}
