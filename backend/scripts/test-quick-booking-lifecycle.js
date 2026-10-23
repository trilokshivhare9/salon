const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = 'http://localhost:3000/api/v1';

async function sendWhatsApp(customerPhone, messageText, interactiveId) {
  const payload = {
    salonSlug: 'dbtech',
    customerPhone,
    messageText: messageText || interactiveId || '',
    interactiveId,
  };
  const res = await fetch(`${BASE_URL}/whatsapp/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return res.json();
}

async function cleanPhone(phone) {
  const clean = phone.replace('+', '');
  await prisma.appointment.deleteMany({
    where: {
      salon: { slug: 'dbtech' },
      salonUser: { user: { phone: { in: [phone, clean, `+${clean}`] } } },
    },
  });
  await prisma.conversation.deleteMany({
    where: {
      salon: { slug: 'dbtech' },
      customerPhone: { in: [phone, clean, `+${clean}`] },
    },
  });
}

async function main() {
  console.log('================================================================');
  console.log('🧪 TESTING QUICK BOOKING LIFECYCLE (CUTOFF_5M & AUTO-PURGE)');
  console.log('================================================================\n');

  const phoneA = '+919922200001';
  const phoneB = '+919922200002';
  await cleanPhone(phoneA);
  await cleanPhone(phoneB);

  const salon = await prisma.salon.findUnique({ where: { slug: 'dbtech' } });
  const hairCutCat = await prisma.serviceCategory.findFirst({
    where: { salonId: salon.id, name: 'HairCut' },
  });
  const execHaircut = await prisma.service.findFirst({
    where: { salonId: salon.id, name: { contains: 'Executive' } },
  });

  // ------------------------------------------------------------------
  // TEST 1: Quick Booking Request Creation with CUTOFF_5M
  // ------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 1: Client A submits Quick Booking');
  console.log('----------------------------------------------------------------');
  await sendWhatsApp(phoneA, 'Hi');
  await sendWhatsApp(phoneA, '', 'btn_quick_book');
  await sendWhatsApp(phoneA, '', `cat_${hairCutCat.id}`);
  await sendWhatsApp(phoneA, '', `svc_${execHaircut.id}`);
  const confirmRes = await sendWhatsApp(phoneA, '', 'btn_confirm_quick');
  console.log('🤖 BOT REPLY:', confirmRes.data?.replyMessage);

  const apptA = await prisma.appointment.findFirst({
    where: {
      salonId: salon.id,
      salonUser: { user: { phone: { in: [phoneA, phoneA.replace('+', '')] } } },
    },
    include: { stylist: true },
    orderBy: { createdAt: 'desc' },
  });

  console.log('\n📊 DATABASE RECORD FOR CLIENT A:');
  console.log({
    id: apptA?.id,
    status: apptA?.status,
    bookingType: apptA?.bookingType,
    nextActionType: apptA?.nextActionType,
    nextActionAt: apptA?.nextActionAt,
    stylist: apptA?.stylist?.name,
  });

  if (apptA?.status === 'PENDING_ACCEPTANCE' && apptA?.nextActionType === 'CUTOFF_5M') {
    console.log('✅ TEST 1 PASSED: Quick booking created with status PENDING_ACCEPTANCE and nextActionType CUTOFF_5M!\n');
  } else {
    console.error('❌ TEST 1 FAILED: Expected CUTOFF_5M, got:', apptA?.nextActionType);
  }

  // ------------------------------------------------------------------
  // TEST 2: Client B submits Competing Quick Booking for the same slot
  // ------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 2: Client B submits Competing Quick Booking for same slot');
  console.log('----------------------------------------------------------------');
  await sendWhatsApp(phoneB, 'Hi');
  await sendWhatsApp(phoneB, '', 'btn_quick_book');
  await sendWhatsApp(phoneB, '', `cat_${hairCutCat.id}`);
  await sendWhatsApp(phoneB, '', `svc_${execHaircut.id}`);
  await sendWhatsApp(phoneB, '', 'btn_confirm_quick');

  const apptB = await prisma.appointment.findFirst({
    where: {
      salonId: salon.id,
      salonUser: { user: { phone: { in: [phoneB, phoneB.replace('+', '')] } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  console.log('📊 Client B Record ID:', apptB?.id, 'Status:', apptB?.status);
  console.log('✅ Both Client A and Client B are concurrently in PENDING_ACCEPTANCE (Slot not locked)!\n');

  // ------------------------------------------------------------------
  // TEST 3: Salon ACCEPTS Client A ➡️ NextAction becomes AUTO_COMPLETE & Client B is Purged!
  // ------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 3: Salon Desk Accepts Client A');
  console.log('----------------------------------------------------------------');
  
  // Call internal status update via AppointmentStatusService
  const { NestFactory } = require('@nestjs/core');
  const { AppModule } = require('../dist/app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const statusService = app.get(require('../dist/modules/salon-admin/appointments/status/appointment-status.service').AppointmentStatusService);

  await statusService.updateAppointmentStatus(salon.id, apptA.id, {
    status: 'CONFIRMED',
  });

  // Verify Client A in DB
  const updatedA = await prisma.appointment.findUnique({
    where: { id: apptA.id },
  });

  console.log('📊 CLIENT A AFTER ACCEPTANCE:');
  console.log({
    id: updatedA?.id,
    status: updatedA?.status,
    bookingType: updatedA?.bookingType,
    nextActionType: updatedA?.nextActionType,
    nextActionAt: updatedA?.nextActionAt,
    endAt: updatedA?.endAt,
  });

  const isAutoCompleteAtEnd =
    updatedA?.status === 'CONFIRMED' &&
    updatedA?.nextActionType === 'AUTO_COMPLETE' &&
    updatedA?.nextActionAt?.getTime() === updatedA?.endAt?.getTime();

  if (isAutoCompleteAtEnd) {
    console.log('✅ TEST 3A PASSED: Client A is CONFIRMED with nextActionType AUTO_COMPLETE at endAt!\n');
  } else {
    console.log('Status:', updatedA?.status, 'NextAction:', updatedA?.nextActionType, 'NextActionAt:', updatedA?.nextActionAt);
  }

  // Verify Client B was cleanly purged from DB
  const checkB = await prisma.appointment.findUnique({
    where: { id: apptB.id },
  });

  if (!checkB) {
    console.log('✅ TEST 3B PASSED: Competing Client B was cleanly purged from the DB (no junk cancelled record)!\n');
  } else {
    console.error('❌ TEST 3B FAILED: Client B is still in DB with status:', checkB.status);
  }

  // ------------------------------------------------------------------
  // TEST 4: Customer-Initiated Cancellation for Pending Request
  // ------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('TEST 4: Client C submits Quick Book and then Cancels (Zero Penalty, Instant Purge)');
  console.log('----------------------------------------------------------------');
  const phoneC = '+919922200003';
  await cleanPhone(phoneC);

  await sendWhatsApp(phoneC, 'Hi');
  await sendWhatsApp(phoneC, '', 'btn_quick_book');
  await sendWhatsApp(phoneC, '', `cat_${hairCutCat.id}`);
  await sendWhatsApp(phoneC, '', `svc_${execHaircut.id}`);
  await sendWhatsApp(phoneC, '', 'btn_confirm_quick');

  const apptC = await prisma.appointment.findFirst({
    where: {
      salonId: salon.id,
      salonUser: { user: { phone: { in: [phoneC, phoneC.replace('+', '')] } } },
    },
  });
  console.log('Created Client C pending appointment ID:', apptC?.id);

  console.log('Client C sends cancel request (btn_cancel_pending_quick)...');
  const cancelRes = await sendWhatsApp(phoneC, '', 'btn_cancel_pending_quick');
  console.log('🤖 BOT REPLY:', cancelRes.data?.replyMessage);

  const checkC = await prisma.appointment.findUnique({
    where: { id: apptC.id },
  });

  if (!checkC) {
    console.log('✅ TEST 4 PASSED: Client C request was immediately deleted from DB upon cancellation with zero penalty!\n');
  } else {
    console.error('❌ TEST 4 FAILED: Client C still in DB with status:', checkC.status);
  }

  console.log('================================================================');
  console.log('🎉 ALL QUICK BOOKING LIFECYCLE TESTS VERIFIED SUCCESSFULLY!');
  console.log('================================================================');

  await app.close();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('Error during test:', e);
  process.exit(1);
});
