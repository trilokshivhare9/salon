import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';
import { ServiceStatus, SalonStatus, StylistStatus } from '@prisma/client';

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}

  private async syncSalonActiveStatus(salonId: string) {
    const activeStylistCount = await this.prisma.stylist.count({
      where: { salonId, status: StylistStatus.ACTIVE },
    });
    const activeServiceCount = await this.prisma.service.count({
      where: { salonId, status: ServiceStatus.ACTIVE },
    });

    const meetsRequirements = activeStylistCount >= 1 && activeServiceCount >= 1;
    await this.prisma.salon.update({
      where: { id: salonId },
      data: { status: meetsRequirements ? SalonStatus.ACTIVE : SalonStatus.INACTIVE },
    });
  }

  async getSalonServices(salonId: string) {
    return this.prisma.service.findMany({
      where: { salonId },
      include: {
        stylists: {
          include: {
            stylist: true,
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
          include: {
            stylist: true,
          },
        },
      },
    });

    if (!service) {
      throw new NotFoundException('Service not found.');
    }

    return service;
  }

  async createService(salonId: string, dto: CreateServiceDto) {
    const service = await this.prisma.service.create({
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

    await this.syncSalonActiveStatus(salonId);
    return service;
  }

  async updateService(salonId: string, serviceId: string, dto: UpdateServiceDto) {
    await this.getServiceById(salonId, serviceId);

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: dto,
    });

    await this.syncSalonActiveStatus(salonId);
    return updated;
  }

  async toggleServiceStatus(salonId: string, serviceId: string) {
    const service = await this.getServiceById(salonId, serviceId);
    const newStatus = service.status === ServiceStatus.ACTIVE ? ServiceStatus.INACTIVE : ServiceStatus.ACTIVE;

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: { status: newStatus },
    });

    await this.syncSalonActiveStatus(salonId);
    return updated;
  }

  async deleteService(salonId: string, serviceId: string) {
    await this.getServiceById(salonId, serviceId);

    const deleted = await this.prisma.service.delete({
      where: { id: serviceId },
    });

    await this.syncSalonActiveStatus(salonId);
    return deleted;
  }
}
