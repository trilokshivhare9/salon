import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateServiceDto, UpdateServiceDto } from './dto/create-service.dto';

@Injectable()
export class ServicesService {
  constructor(private prisma: PrismaService) {}

  async getSalonServices(salonId: string) {
    return this.prisma.service.findMany({
      where: { salonId },
      include: {
        staffAssignments: {
          include: {
            staff: {
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
        staffAssignments: {
          include: { staff: true },
        },
      },
    });

    if (!service) {
      throw new NotFoundException('Service not found or does not belong to this salon.');
    }

    return service;
  }

  async createService(salonId: string, dto: CreateServiceDto) {
    const service = await this.prisma.service.create({
      data: {
        salonId,
        name: dto.name,
        description: dto.description,
        price: dto.price,
        durationMinutes: dto.durationMinutes,
        category: dto.category,
      },
    });

    // Auto-evaluate Salon Activation
    const [activeStaffCount, activeServicesCount] = await Promise.all([
      this.prisma.staff.count({ where: { salonId, status: 'ACTIVE' } }),
      this.prisma.service.count({ where: { salonId, status: 'ACTIVE' } }),
    ]);

    if (activeStaffCount > 0 && activeServicesCount > 0) {
      await this.prisma.salon.update({
        where: { id: salonId },
        data: { status: 'ACTIVE' },
      });
    }

    return service;
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
    const newStatus = service.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';

    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: { status: newStatus },
    });

    // Auto-evaluate Salon Activation
    const [activeStaffCount, activeServicesCount] = await Promise.all([
      this.prisma.staff.count({ where: { salonId, status: 'ACTIVE' } }),
      this.prisma.service.count({ where: { salonId, status: 'ACTIVE' } }),
    ]);

    const salonStatus = activeStaffCount > 0 && activeServicesCount > 0 ? 'ACTIVE' : 'DEACTIVATED';
    await this.prisma.salon.update({
      where: { id: salonId },
      data: { status: salonStatus as any },
    });

    return updated;
  }

  async deleteService(salonId: string, serviceId: string) {
    await this.getServiceById(salonId, serviceId);

    const deleted = await this.prisma.service.delete({
      where: { id: serviceId },
    });

    // Auto-evaluate Salon Activation
    const [activeStaffCount, activeServicesCount] = await Promise.all([
      this.prisma.staff.count({ where: { salonId, status: 'ACTIVE' } }),
      this.prisma.service.count({ where: { salonId, status: 'ACTIVE' } }),
    ]);

    const salonStatus = activeStaffCount > 0 && activeServicesCount > 0 ? 'ACTIVE' : 'DEACTIVATED';
    await this.prisma.salon.update({
      where: { id: salonId },
      data: { status: salonStatus as any },
    });

    return deleted;
  }
}
