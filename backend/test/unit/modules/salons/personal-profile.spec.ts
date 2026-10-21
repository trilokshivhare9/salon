import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException } from '@nestjs/common';
import { PersonalProfileService } from '../../../../src/modules/salon-admin/personal-profile/personal-profile.service';
import { PrismaService } from '../../../../src/database/prisma.service';

describe('PersonalProfileService', () => {
  let service: PersonalProfileService;
  let prisma: any;

  const mockAdmin = {
    id: 'admin-uuid-1',
    name: 'Trilok Shivhare',
    email: 'dbtrilok@gmail.com',
    phone: '+917999817743',
    role: 'SALON_OWNER',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
  };

  const mockSalon = {
    id: 'salon-uuid-1',
    name: 'Developer Bazaar Salon',
    slug: 'developer-bazaar-salon',
    phone: '+917999817743',
    email: 'dbtrilok@gmail.com',
    address: 'Scheme 78, Vijay Nagar',
    city: 'Indore',
    state: 'Madhya Pradesh',
    country: 'IN',
    latitude: 22.7533,
    longitude: 75.8937,
    googleMapsUrl: 'https://maps.google.com/?q=22.7533,75.8937',
    locationType: 'GPS_PIN',
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  beforeEach(async () => {
    prisma = {
      salon: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      admin: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(async (cb) => cb(prisma)),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PersonalProfileService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<PersonalProfileService>(PersonalProfileService);
  });

  describe('getPersonalProfile', () => {
    it('should successfully retrieve unified salon and owner profile', async () => {
      prisma.salon.findUnique.mockResolvedValue(mockSalon);
      prisma.admin.findUnique.mockResolvedValue(mockAdmin);

      const result = await service.getPersonalProfile('salon-uuid-1', 'admin-uuid-1');

      expect(result).toBeDefined();
      expect(result.owner.name).toBe('Trilok Shivhare');
      expect(result.owner.email).toBe('dbtrilok@gmail.com');
      expect(result.salon.name).toBe('Developer Bazaar Salon');
      expect(result.salon.city).toBe('Indore');
      expect(result.salon.latitude).toBe(22.7533);
    });

    it('should throw NotFoundException if salon is not found', async () => {
      prisma.salon.findUnique.mockResolvedValue(null);
      prisma.admin.findUnique.mockResolvedValue(mockAdmin);

      await expect(service.getPersonalProfile('non-existent-salon', 'admin-uuid-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw NotFoundException if admin is not found', async () => {
      prisma.salon.findUnique.mockResolvedValue(mockSalon);
      prisma.admin.findUnique.mockResolvedValue(null);

      await expect(service.getPersonalProfile('salon-uuid-1', 'non-existent-admin')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updatePersonalProfile', () => {
    it('should atomically update both owner credentials and salon information', async () => {
      prisma.admin.findFirst.mockResolvedValue(null); // No duplicate email
      const updatedAdmin = { ...mockAdmin, name: 'Trilok Shivhare Updated', email: 'updated@gmail.com' };
      const updatedSalon = { ...mockSalon, name: 'Updated Salon Name', city: 'Bhopal' };

      prisma.admin.update.mockResolvedValue(updatedAdmin);
      prisma.salon.update.mockResolvedValue(updatedSalon);

      const payload = {
        owner: {
          name: 'Trilok Shivhare Updated',
          email: 'updated@gmail.com',
        },
        salon: {
          name: 'Updated Salon Name',
          city: 'Bhopal',
          address: 'New Market, Bhopal',
          latitude: 23.2599,
          longitude: 77.4126,
        },
      };

      const result = await service.updatePersonalProfile('salon-uuid-1', 'admin-uuid-1', payload);

      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: 'admin-uuid-1' },
        data: { name: 'Trilok Shivhare Updated', email: 'updated@gmail.com' },
      });
      expect(prisma.salon.update).toHaveBeenCalledWith({
        where: { id: 'salon-uuid-1' },
        data: expect.objectContaining({
          name: 'Updated Salon Name',
          city: 'Bhopal',
          address: 'New Market, Bhopal',
          latitude: 23.2599,
          longitude: 77.4126,
        }),
      });
      expect(result.owner.name).toBe('Trilok Shivhare Updated');
      expect(result.salon.name).toBe('Updated Salon Name');
    });

    it('should throw ConflictException if the new recovery email is taken by another admin', async () => {
      prisma.admin.findFirst.mockResolvedValue({ id: 'other-admin-uuid', email: 'taken@gmail.com' });

      await expect(
        service.updatePersonalProfile('salon-uuid-1', 'admin-uuid-1', {
          owner: { email: 'taken@gmail.com' },
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should accept top-level alias fields without nested objects', async () => {
      prisma.admin.findFirst.mockResolvedValue(null);
      prisma.admin.update.mockResolvedValue({ ...mockAdmin, name: 'Flat Name' });
      prisma.salon.update.mockResolvedValue({ ...mockSalon, name: 'Flat Salon' });

      const result = await service.updatePersonalProfile('salon-uuid-1', 'admin-uuid-1', {
        ownerName: 'Flat Name',
        salonName: 'Flat Salon',
      });

      expect(prisma.admin.update).toHaveBeenCalledWith({
        where: { id: 'admin-uuid-1' },
        data: { name: 'Flat Name' },
      });
      expect(prisma.salon.update).toHaveBeenCalledWith({
        where: { id: 'salon-uuid-1' },
        data: expect.objectContaining({ name: 'Flat Salon' }),
      });
      expect(result.owner.name).toBe('Flat Name');
    });
  });
});
