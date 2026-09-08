import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

async function resetRealUsersPenalties() {
  console.log('🔄 Checking and resetting any real user penalty counts...');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);

  try {
    // Find all salon users with penalty strikes or blocked status
    const penalizedUsers = await prisma.salonUser.findMany({
      where: {
        OR: [
          { yearlyNoShowCount: { gt: 0 } },
          { isBookingBlocked: true },
        ],
      },
      include: {
        user: true,
        salon: true,
      },
    });

    console.log(`Found ${penalizedUsers.length} user(s) with penalty strikes:`);
    for (const su of penalizedUsers) {
      console.log(`  - Customer: ${su.user?.name || 'Unnamed'} (${su.user?.phone}) | Salon: ${su.salon?.name} | Strikes: ${su.yearlyNoShowCount} | Blocked: ${su.isBookingBlocked}`);
    }

    // Reset all salon users to 0 strikes & unblocked
    const resetResult = await prisma.salonUser.updateMany({
      where: {
        OR: [
          { yearlyNoShowCount: { gt: 0 } },
          { isBookingBlocked: true },
        ],
      },
      data: {
        yearlyNoShowCount: 0,
        isBookingBlocked: false,
        lastNoShowDate: null,
      },
    });

    console.log(`\n✅ Successfully reset ${resetResult.count} user account(s) to 0 penalty strikes and unblocked!`);
  } catch (err) {
    console.error('Error resetting penalties:', err);
  } finally {
    await app.close();
  }
}

resetRealUsersPenalties();
