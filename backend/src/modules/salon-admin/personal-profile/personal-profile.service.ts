import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { UpdatePersonalProfileDto } from './dto/update-personal-profile.dto';
import { PersonalProfileResponse } from './dto/personal-profile-response.dto';

@Injectable()
export class PersonalProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retrieves unified personal profile information (Salon details + Owner credentials)
   */
  async getPersonalProfile(salonId: string, adminId: string): Promise<PersonalProfileResponse> {
    const [salon, admin] = await Promise.all([
      this.prisma.salon.findUnique({
        where: { id: salonId },
      }),
      this.prisma.admin.findUnique({
        where: { id: adminId },
      }),
    ]);

    if (!salon) {
      throw new NotFoundException('Salon not found.');
    }

    if (!admin) {
      throw new NotFoundException('Admin user not found.');
    }

    return {
      owner: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        phone: admin.phone,
        role: admin.role,
        status: admin.status,
        createdAt: admin.createdAt,
      },
      salon: {
        id: salon.id,
        name: salon.name,
        slug: salon.slug,
        phone: salon.phone,
        email: salon.email,
        address: salon.address,
        city: salon.city,
        state: salon.state,
        country: salon.country,
        latitude: salon.latitude,
        longitude: salon.longitude,
        googleMapsUrl: salon.googleMapsUrl,
        locationType: salon.locationType,
        status: salon.status,
        createdAt: salon.createdAt,
        updatedAt: salon.updatedAt,
      },
    };
  }

  /**
   * Updates unified personal profile (Salon details & Owner credentials in an atomic transaction)
   */
  async updatePersonalProfile(
    salonId: string,
    adminId: string,
    dto: UpdatePersonalProfileDto,
  ): Promise<PersonalProfileResponse> {
    // 1. Resolve owner properties
    const ownerName = dto.owner?.name !== undefined ? dto.owner.name : dto.ownerName;
    const ownerEmail = dto.owner?.email !== undefined ? dto.owner.email : dto.ownerEmail;

    // 2. Resolve salon properties
    const salonName = dto.salon?.name !== undefined ? dto.salon.name : dto.salonName;
    const city = dto.salon?.city !== undefined ? dto.salon.city : dto.city;
    const state = dto.salon?.state !== undefined ? dto.salon.state : dto.state;
    const rawAddress = dto.salon?.address !== undefined ? dto.salon.address : dto.address;
    const pincode = dto.salon?.pincode !== undefined ? dto.salon.pincode : dto.pincode;
    let address = rawAddress;
    if (address && pincode && pincode.trim() && !address.includes(pincode.trim())) {
      address = `${address.trim()} - ${pincode.trim()}`;
    }
    const latitude = dto.salon?.latitude !== undefined ? dto.salon.latitude : dto.latitude;
    const longitude = dto.salon?.longitude !== undefined ? dto.salon.longitude : dto.longitude;
    const googleMapsUrl = dto.salon?.googleMapsUrl !== undefined ? dto.salon.googleMapsUrl : dto.googleMapsUrl;
    const locationType = dto.salon?.locationType !== undefined ? dto.salon.locationType : dto.locationType;

    // 3. Email uniqueness guard
    if (ownerEmail) {
      const normalizedEmail = ownerEmail.trim().toLowerCase();
      const duplicate = await this.prisma.admin.findFirst({
        where: {
          email: normalizedEmail,
          id: { not: adminId },
        },
      });

      if (duplicate) {
        throw new ConflictException('This recovery email address is already in use by another user.');
      }
    }

    // 4. Atomic transaction update
    const [updatedAdmin, updatedSalon] = await this.prisma.$transaction(async (tx) => {
      const adminUpdateData: any = {};
      if (ownerName !== undefined && ownerName.trim()) {
        adminUpdateData.name = ownerName.trim();
      }
      if (ownerEmail !== undefined && ownerEmail.trim()) {
        adminUpdateData.email = ownerEmail.trim().toLowerCase();
      }

      const adminUpdate = Object.keys(adminUpdateData).length > 0
        ? await tx.admin.update({
          where: { id: adminId },
          data: adminUpdateData,
        })
        : await tx.admin.findUnique({ where: { id: adminId } });

      const salonUpdateData: any = {};
      if (salonName !== undefined && salonName.trim()) {
        salonUpdateData.name = salonName.trim();
      }
      if (city !== undefined) salonUpdateData.city = city.trim();
      if (state !== undefined) salonUpdateData.state = state.trim();
      if (address !== undefined) salonUpdateData.address = address.trim();
      if (typeof latitude === 'number' && !isNaN(latitude)) {
        salonUpdateData.latitude = latitude;
      }
      if (typeof longitude === 'number' && !isNaN(longitude)) {
        salonUpdateData.longitude = longitude;
      }
      if (googleMapsUrl !== undefined) salonUpdateData.googleMapsUrl = googleMapsUrl.trim();
      if (locationType !== undefined) salonUpdateData.locationType = locationType.trim();

      const salonUpdate = Object.keys(salonUpdateData).length > 0
        ? await tx.salon.update({
          where: { id: salonId },
          data: salonUpdateData,
        })
        : await tx.salon.findUnique({ where: { id: salonId } });

      return [adminUpdate, salonUpdate];
    });

    if (!updatedSalon) {
      throw new NotFoundException('Salon not found.');
    }
    if (!updatedAdmin) {
      throw new NotFoundException('Admin user not found.');
    }

    return {
      owner: {
        id: updatedAdmin.id,
        name: updatedAdmin.name,
        email: updatedAdmin.email,
        phone: updatedAdmin.phone,
        role: updatedAdmin.role,
        status: updatedAdmin.status,
        createdAt: updatedAdmin.createdAt,
      },
      salon: {
        id: updatedSalon.id,
        name: updatedSalon.name,
        slug: updatedSalon.slug,
        phone: updatedSalon.phone,
        email: updatedSalon.email,
        address: updatedSalon.address,
        city: updatedSalon.city,
        state: updatedSalon.state,
        country: updatedSalon.country,
        latitude: updatedSalon.latitude,
        longitude: updatedSalon.longitude,
        googleMapsUrl: updatedSalon.googleMapsUrl,
        locationType: updatedSalon.locationType,
        status: updatedSalon.status,
        createdAt: updatedSalon.createdAt,
        updatedAt: updatedSalon.updatedAt,
      },
    };
  }
}
