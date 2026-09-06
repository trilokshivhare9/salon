import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';
import { ServiceStatus } from '@prisma/client';

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}

  async getSalonServices(salonId: string) {
    return this.prisma.service.findMany({
      where: { salonId },
      include: {
        stylists: {
          include: {
            stylist: {
              select: { id: true, name: true, profileImageUrl: true, status: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getServiceById(salonId: string, serviceId: string) {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, salonId },
      include: {
        stylists: {
          include: { stylist: true },
        },
      },
    });

    if (!service) {
      throw new NotFoundException('Service not found or does not belong to this salon.');
    }

    return service;
  }

  async createService(salonId: string, dto: CreateServiceDto) {
    return this.prisma.service.create({
      data: {
        salonId,
        name: dto.name.trim(),
        description: dto.description?.trim(),
        price: dto.price,
        durationMinutes: dto.durationMinutes,
        category: dto.category?.trim(),
        status: ServiceStatus.ACTIVE,
      },
    });
  }

  async updateService(salonId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.getServiceById(salonId, serviceId);

    return this.prisma.service.update({
      where: { id: serviceId },
      data: dto,
    });
  }

  async toggleServiceStatus(salonId: string, serviceId: string) {
    const service = await this.getServiceById(salonId, serviceId);
    const newStatus = service.status === ServiceStatus.ACTIVE ? ServiceStatus.INACTIVE : ServiceStatus.ACTIVE;

    return this.prisma.service.update({
      where: { id: serviceId },
      data: { status: newStatus },
    });
  }

  async deleteService(salonId: string, serviceId: string) {
    await this.getServiceById(salonId, serviceId);

    return this.prisma.service.delete({
      where: { id: serviceId },
    });
  }
}
