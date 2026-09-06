import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterSalonDto } from './dto/register.dto';
import { AdminRole, DayOfWeek } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const admin = await this.prisma.admin.findUnique({
      where: { email: loginDto.email.toLowerCase().trim() },
      include: { salon: true },
    });

    if (!admin) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, admin.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (admin.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account has been deactivated.');
    }

    const payload = {
      sub: admin.id,
      email: admin.email,
      role: admin.role,
      salonId: admin.salonId,
    };

    const token = this.jwtService.sign(payload);

    return {
      accessToken: token,
      user: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        salonId: admin.salonId,
        salon: admin.salon
          ? {
              id: admin.salon.id,
              name: admin.salon.name,
              slug: admin.salon.slug,
              timezone: admin.salon.timezone,
              status: admin.salon.status,
            }
          : null,
      },
    };
  }

  async registerSalon(registerDto: RegisterSalonDto) {
    const email = registerDto.email.toLowerCase().trim();
    const existingAdmin = await this.prisma.admin.findUnique({
      where: { email },
    });

    if (existingAdmin) {
      throw new ConflictException('An account with this email already exists.');
    }

    // Generate unique slug from salon name
    let baseSlug = registerDto.salonName
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    let slug = baseSlug;
    let slugIndex = 1;
    while (await this.prisma.salon.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${slugIndex}`;
      slugIndex++;
    }

    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(registerDto.password, salt);

    return this.prisma.$transaction(async (tx) => {
      // 1. Create a placeholder/creator admin first or create owner directly
      const ownerAdmin = await tx.admin.create({
        data: {
          name: registerDto.ownerName,
          email,
          phone: registerDto.phone,
          passwordHash,
          role: AdminRole.SALON_OWNER,
        },
      });

      // 2. Create Salon with createdByAdminId
      const salon = await tx.salon.create({
        data: {
          createdByAdminId: ownerAdmin.id,
          name: registerDto.salonName,
          slug,
          phone: registerDto.phone,
          email,
          city: registerDto.city,
          timezone: registerDto.timezone || 'Asia/Kolkata',
          defaultStartTime: '09:00',
          defaultEndTime: '21:00',
        },
      });

      // 3. Link ownerAdmin to this salon
      await tx.admin.update({
        where: { id: ownerAdmin.id },
        data: { salonId: salon.id },
      });

      // 4. Automatically populate 7-Day Default Working Hours
      const days: DayOfWeek[] = [
        DayOfWeek.SUNDAY,
        DayOfWeek.MONDAY,
        DayOfWeek.TUESDAY,
        DayOfWeek.WEDNESDAY,
        DayOfWeek.THURSDAY,
        DayOfWeek.FRIDAY,
        DayOfWeek.SATURDAY,
      ];

      for (const day of days) {
        await tx.salonWorkingHours.create({
          data: {
            salonId: salon.id,
            dayOfWeek: day,
            isClosed: false,
            startTime: '09:00',
            endTime: '21:00',
          },
        });
      }

      const payload = {
        sub: ownerAdmin.id,
        email: ownerAdmin.email,
        role: ownerAdmin.role,
        salonId: salon.id,
      };

      const token = this.jwtService.sign(payload);

      return {
        accessToken: token,
        user: {
          id: ownerAdmin.id,
          name: ownerAdmin.name,
          email: ownerAdmin.email,
          role: ownerAdmin.role,
          salonId: salon.id,
          salon: {
            id: salon.id,
            name: salon.name,
            slug: salon.slug,
            timezone: salon.timezone,
            status: salon.status,
          },
        },
      };
    });
  }

  async getMe(adminId: string) {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
      include: { salon: true },
    });

    if (!admin) {
      throw new NotFoundException('Admin not found.');
    }

    return {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
      salonId: admin.salonId,
      salon: admin.salon,
    };
  }
}
