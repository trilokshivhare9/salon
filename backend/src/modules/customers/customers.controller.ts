import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CurrentSalonId } from '../../common/decorators/tenant.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  @Get()
  async getCustomers(
    @CurrentSalonId() salonId: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.customersService.getCustomers(
      salonId,
      search,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get(':id')
  async getCustomerById(
    @CurrentSalonId() salonId: string,
    @Param('id') customerId: string,
  ) {
    return this.customersService.getCustomerById(salonId, customerId);
  }

  @Patch(':id/unblock')
  async unblockCustomer(
    @CurrentSalonId() salonId: string,
    @Param('id') customerId: string,
  ) {
    return this.customersService.unblockCustomer(salonId, customerId);
  }

  @Patch(':id/strikes')
  async updateCustomerStrikes(
    @CurrentSalonId() salonId: string,
    @Param('id') customerId: string,
    @Body('yearlyNoShowCount') yearlyNoShowCount: number,
    @Body('isBookingBlocked') isBookingBlocked?: boolean,
  ) {
    return this.customersService.updateCustomerStrikes(
      salonId,
      customerId,
      yearlyNoShowCount,
      isBookingBlocked,
    );
  }
}

