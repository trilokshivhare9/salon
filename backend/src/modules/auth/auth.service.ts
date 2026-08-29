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
import { UserRole } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
  ) {}

  async login(loginDto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: loginDto.email.toLowerCase() },
      include: { salon: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isPasswordValid = await bcrypt.compare(loginDto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Account has been deactivated.');
    }

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      salonId: user.salonId,
    };

    const token = this.jwtService.sign(payload);

    return {
      accessToken: token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        salonId: user.salonId,
        salon: user.salon
          ? {
              id: user.salon.id,
              name: user.salon.name,
              slug: user.salon.slug,
              timezone: user.salon.timezone,
              status: user.salon.status,
            }
          : null,
      },
    };
  }

  async registerSalon(registerDto: RegisterSalonDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: registerDto.email.toLowerCase() },
    });

    if (existingUser) {
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

    // Create salon, admin user, default working hours and subscription within a transaction
    return this.prisma.$transaction(async (tx) => {
      // 1. Create Default Plan if not exists
      let defaultPlan = await tx.plan.findFirst({ where: { name: 'Trial' } });
      if (!defaultPlan) {
        defaultPlan = await tx.plan.create({
          data: {
            name: 'Trial',
            priceMonthly: 0,
            priceYearly: 0,
            maxStaff: 10,
            maxServices: 50,
            allowWhatsApp: true,
          },
        });
      }

      // 2. Create Salon
      const salon = await tx.salon.create({
        data: {
          name: registerDto.salonName,
          slug,
          phone: registerDto.phone,
          email: registerDto.email.toLowerCase(),
          city: registerDto.city,
          timezone: registerDto.timezone || 'Asia/Kolkata',
        },
      });

      // 3. Create Subscription (14 day trial)
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 14);

      await tx.subscription.create({
        data: {
          salonId: salon.id,
          planId: defaultPlan.id,
          status: 'TRIAL',
          trialStartDate: new Date(),
          trialEndDate,
        },
      });

      // 4. Create Salon Admin User
      const user = await tx.user.create({
        data: {
          salonId: salon.id,
          name: registerDto.ownerName,
          email: registerDto.email.toLowerCase(),
          phone: registerDto.phone,
          passwordHash,
          role: UserRole.SALON_ADMIN,
        },
      });

      // 5. Populate Standard Working Hours (Mon - Sun: 10:00 - 20:00)
      const days = [
        'MONDAY',
        'TUESDAY',
        'WEDNESDAY',
        'THURSDAY',
        'FRIDAY',
        'SATURDAY',
        'SUNDAY',
      ] as const;

      for (const day of days) {
        await tx.workingHours.create({
          data: {
            salonId: salon.id,
            dayOfWeek: day,
            isOpen: true,
            openTime: '10:00',
            closeTime: '20:00',
          },
        });
      }

      const payload = {
        sub: user.id,
        email: user.email,
        role: user.role,
        salonId: salon.id,
      };

      const token = this.jwtService.sign(payload);

      return {
        accessToken: token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
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

  async getMe(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { salon: true },
    });

    if (!user) {
      throw new NotFoundException('User not found.');
    }

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      salonId: user.salonId,
      salon: user.salon,
    };
  }
}
