import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole, SalonStatus } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private prisma: PrismaService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Unauthenticated requests bypass tenant context guard (handled by JwtAuthGuard)
    if (!user) {
      return true;
    }

    const headerSalonId = (request.headers['x-salon-id'] as string || '').trim();
    const paramSalonId = (request.params?.salonId || request.params?.id as string || '').trim();

    if (user.role === AdminRole.SALON_OWNER) {
      const userSalonId = user.salonId;
      if (!userSalonId) {
        throw new ForbiddenException('Salon Owner account has no associated salon.');
      }

      // Check for conflicting tenant claims in headers or route params
      if (headerSalonId && headerSalonId !== userSalonId) {
        throw new ForbiddenException('Cross-tenant access attempt rejected. Header salonId mismatch.');
      }

      if (paramSalonId && paramSalonId.length === 36 && paramSalonId !== userSalonId) {
        // If route param is a UUID and doesn't match the user's salonId
        throw new ForbiddenException('Cross-tenant access attempt rejected. Route param salonId mismatch.');
      }

      // Establish authoritative tenant context
      request.tenantSalonId = userSalonId;
      return true;
    }

    if (user.role === AdminRole.SUPER_ADMIN) {
      // Resolve target salon ID from header or route parameter
      const targetSalonId = headerSalonId || (paramSalonId.length === 36 ? paramSalonId : null);

      if (targetSalonId) {
        const salon = await this.prisma.salon.findUnique({
          where: { id: targetSalonId },
          select: { id: true, status: true },
        });

        if (!salon) {
          throw new NotFoundException(`Target salon context '${targetSalonId}' does not exist.`);
        }

        if (salon.status === SalonStatus.DEACTIVATED) {
          throw new ForbiddenException(`Target salon context '${targetSalonId}' is deactivated.`);
        }

        request.tenantSalonId = salon.id;
      } else if (user.salonId) {
        request.tenantSalonId = user.salonId;
      }
      return true;
    }

    return true;
  }
}
