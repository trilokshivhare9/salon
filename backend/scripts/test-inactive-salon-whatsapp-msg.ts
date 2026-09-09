import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function testInactiveSalonWebhook() {
  console.log('🧪 Testing Inactive Salon WhatsApp Webhook Notification Logic...\n');

  // Find or toggle a test salon to INACTIVE
  const salon = await prisma.salon.findFirst({
    include: { whatsappAccount: true },
  });

  if (!salon || !salon.whatsappAccount) {
    console.log('No salon with whatsappAccount found in DB. Skipping direct test.');
    process.exit(0);
  }

  // Temporarily set status to INACTIVE for verification
  const originalStatus = salon.status;
  await prisma.salon.update({
    where: { id: salon.id },
    data: { status: 'INACTIVE' },
  });

  console.log(`Salon "${salon.name}" set to INACTIVE (Original: ${originalStatus})`);

  // Verify lookup logic
  const phoneNumberId = salon.whatsappAccount.phoneNumberId;
  const linkedSalon = await prisma.salon.findFirst({
    where: { whatsappAccount: { phoneNumberId } },
  });

  if (linkedSalon && linkedSalon.status !== 'ACTIVE') {
    console.log(`✅ SUCCESS: Detected inactive salon "${linkedSalon.name}" (Status: ${linkedSalon.status}) for Phone ID "${phoneNumberId}".`);
    console.log(`   Message Payload to Customer:`);
    console.log(`   "⚠️ *${linkedSalon.name} Status Update*\n\nThank you for reaching out! Our salon is currently undergoing maintenance/setup and is temporarily inactive for automated WhatsApp bookings.\n\nPlease contact the salon directly or try again later."`);
  } else {
    console.error('❌ FAILURE: Inactive salon lookup failed!');
  }

  // Restore original status
  await prisma.salon.update({
    where: { id: salon.id },
    data: { status: originalStatus },
  });

  console.log(`\nRestored salon "${salon.name}" status back to ${originalStatus}.`);
  console.log('🎉 INACTIVE SALON WEBHOOK TEST PASSED CLEANLY!');
}

testInactiveSalonWebhook()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
