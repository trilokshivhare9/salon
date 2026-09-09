import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { MasterCategoriesService } from './master-categories.service';
import { CreateMasterCategoryDto, UpdateMasterCategoryDto } from './dto/master-category.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminRole } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AdminRole.SUPER_ADMIN)
@Controller('super-admin/categories')
export class MasterCategoriesController {
  constructor(private readonly masterCategoriesService: MasterCategoriesService) {}

  @Get()
  async getAllMasterCategories() {
    return this.masterCategoriesService.getAllMasterCategories();
  }

  @Post()
  async createMasterCategory(@Body() dto: CreateMasterCategoryDto) {
    return this.masterCategoriesService.createMasterCategory(dto);
  }

  @Patch(':id')
  async updateMasterCategory(
    @Param('id') id: string,
    @Body() dto: UpdateMasterCategoryDto,
  ) {
    return this.masterCategoriesService.updateMasterCategory(id, dto);
  }

  @Delete(':id')
  async deleteMasterCategory(@Param('id') id: string) {
    return this.masterCategoriesService.deleteMasterCategory(id);
  }
}
