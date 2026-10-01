import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../database/prisma.service';

@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);

  // Multi-tenant in-memory catalog cache with 3-minute TTL to eliminate repetitive heavy joins
  private readonly catalogCache = new Map<string, { salon: any; cachedAt: number }>();
  private readonly CATALOG_CACHE_TTL_MS = 3 * 60 * 1000;
  private readonly MAX_CATALOG_CACHE_SIZE = 500;

  constructor(private readonly prisma: PrismaService) {}

  public invalidateSalonCatalog(salonId: string): void {
    this.catalogCache.delete(salonId);
  }

  public async getCachedSalon(salonId: string): Promise<any> {
    const now = Date.now();
    const entry = this.catalogCache.get(salonId);
    if (entry && now - entry.cachedAt < this.CATALOG_CACHE_TTL_MS) {
      // Defensive shallow copy to prevent downstream mutation of shared cached reference
      return { ...entry.salon, staff: entry.salon.stylists || entry.salon.staff };
    }

    const salon: any = await this.prisma.salon.findUnique({
      where: { id: salonId },
      include: {
        serviceCategories: { orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] },
        services: {
          where: {
            status: 'ACTIVE',
          },
          include: { serviceCategory: true, stylists: { include: { stylist: true } } },
          orderBy: { name: 'asc' },
        },
        stylists: { where: { status: 'ACTIVE' }, include: { services: true } },
      },
    });

    if (salon) {
      if (salon.stylists) salon.staff = salon.stylists;
      // Bounded capacity: evict oldest if cache exceeds 500 salons to prevent memory leaks
      if (this.catalogCache.size >= this.MAX_CATALOG_CACHE_SIZE) {
        const oldestKey = this.catalogCache.keys().next().value;
        if (oldestKey) this.catalogCache.delete(oldestKey);
      }
      this.catalogCache.set(salonId, { salon, cachedAt: now });
      return { ...salon };
    }

    return null;
  }
}
