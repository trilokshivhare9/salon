import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { BookingService } from './booking.service';
import { CreateAppointmentDto } from '../appointments/dto/create-appointment.dto';
import { Public } from '../../common/decorators/public.decorator';

@Public()
@Controller('booking')
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Get(':salonSlug')
  async getSalon(@Param('salonSlug') salonSlug: string) {
    return this.bookingService.getSalonBySlug(salonSlug);
  }

  @Get(':salonSlug/availability')
  async getAvailability(
    @Param('salonSlug') salonSlug: string,
    @Query('serviceId') serviceId: string,
    @Query('date') date: string,
    @Query('staffId') staffId?: string,
  ) {
    return this.bookingService.getAvailability(
      salonSlug,
      serviceId,
      date,
      staffId,
    );
  }

  @Post(':salonSlug/appointments')
  async createAppointment(
    @Param('salonSlug') salonSlug: string,
    @Body() dto: CreateAppointmentDto,
  ) {
    return this.bookingService.createPublicAppointment(salonSlug, dto);
  }
}
