import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateMasterCategoryDto, UpdateMasterCategoryDto } from './dto/master-category.dto';

@Injectable()
export class MasterCategoriesService {
  constructor(private prisma: PrismaService) {}

  async getAllMasterCategories() {
    return this.prisma.masterCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createMasterCategory(dto: CreateMasterCategoryDto) {
    const trimmedName = dto.name.trim();
    const existing = await this.prisma.masterCategory.findFirst({
      where: { name: { equals: trimmedName, mode: 'insensitive' } },
    });
    if (existing) {
      throw new BadRequestException(`Master category "${trimmedName}" already exists.`);
    }

    return this.prisma.masterCategory.create({
      data: {
        name: trimmedName,
        icon: dto.icon || 'scissors',
        sortOrder: dto.sortOrder || 0,
      },
    });
  }

  async updateMasterCategory(id: string, dto: UpdateMasterCategoryDto) {
    const existing = await this.prisma.masterCategory.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Master category not found.');
    }

    const data: any = {};
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (!trimmed) throw new BadRequestException('Master category name cannot be empty.');

      const duplicate = await this.prisma.masterCategory.findFirst({
        where: {
          id: { not: id },
          name: { equals: trimmed, mode: 'insensitive' },
        },
      });
      if (duplicate) {
        throw new BadRequestException(`Master category "${trimmed}" already exists.`);
      }
      data.name = trimmed;
    }
    if (dto.icon !== undefined) data.icon = dto.icon;
    if (dto.sortOrder !== undefined) data.sortOrder = dto.sortOrder;

    return this.prisma.masterCategory.update({
      where: { id },
      data,
    });
  }

  async deleteMasterCategory(id: string) {
    const existing = await this.prisma.masterCategory.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Master category not found.');
    }

    return this.prisma.masterCategory.delete({
      where: { id },
    });
  }
}
