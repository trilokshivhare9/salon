import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

export const CurrentSalonId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest();
    const salonId = request.tenantSalonId || request.user?.salonId;
    if (!salonId) {
      throw new UnauthorizedException('Tenant context (salonId) is missing or unauthenticated.');
    }
    return salonId;
  },
);
