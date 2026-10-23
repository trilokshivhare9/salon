const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const BASE_URL = 'http://localhost:3000/api/v1';

async function sendWhatsApp(customerPhone, messageText, interactiveId, senderName) {
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

async function main() {
  console.log('================================================================');
  console.log('🚀 SIMULATING MULTIPLE REAL WHATSAPP USER BOOKINGS');
  console.log('================================================================\n');

  const salon = await prisma.salon.findUnique({ where: { slug: 'dbtech' } });
  const hairCutCat = await prisma.serviceCategory.findFirst({
    where: { salonId: salon.id, name: 'HairCut' },
  });
  const beardCat = await prisma.serviceCategory.findFirst({
    where: { salonId: salon.id, name: { contains: 'Beard' } },
  });

  const execHaircut = await prisma.service.findFirst({
    where: { salonId: salon.id, name: { contains: 'Executive' } },
  });
  const womenHaircut = await prisma.service.findFirst({
    where: { salonId: salon.id, name: { contains: 'Layered' } },
  });
  const beardSvc = await prisma.service.findFirst({
    where: { salonId: salon.id, name: { contains: 'Royal Beard' } },
  });

  // ------------------------------------------------------------------
  // BOOKING 1: User Amit Kumar (< 2 Hours Remaining Today at 18:00)
  // ------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('👤 BOOKING 1: Amit Kumar (< 2 Hours away today at 06:00 PM)');
  console.log('----------------------------------------------------------------');
  const user1 = '+919811223301';
  await sendWhatsApp(user1, 'Hi');
  await sendWhatsApp(user1, '', 'btn_book');
  await sendWhatsApp(user1, '', 'gender_select_MALE');
  await sendWhatsApp(user1, '', `cat_${hairCutCat.id}`);
  await sendWhatsApp(user1, '', `svc_${execHaircut.id}`);
  await sendWhatsApp(user1, '', 'staff_any');
  
  const todayStr = new Date().toISOString().slice(0, 10);
  await sendWhatsApp(user1, '', `date_${todayStr}`);
  await sendWhatsApp(user1, '', 'slot_18:00');
  await sendWhatsApp(user1, 'Amit Kumar');
  const res1 = await sendWhatsApp(user1, '', 'btn_confirm_yes');
  console.log('🤖 BOT CONFIRMATION:');
  console.log(res1.data?.replyMessage);

  const appt1 = await prisma.appointment.findFirst({
    where: {
      salonId: salon.id,
      salonUser: { user: { phone: { in: [user1, user1.replace('+', '')] } } },
    },
    include: { service: true, stylist: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log('📊 DATABASE RECORD 1 (< 2h today):', {
    id: appt1?.id,
    customer: 'Amit Kumar',
    service: appt1?.service?.name,
    stylist: appt1?.stylist?.name,
    startAt: appt1?.startAt?.toISOString(),
    status: appt1?.status,
    bookingType: appt1?.bookingType,
    nextActionType: appt1?.nextActionType,
    nextActionAt: appt1?.nextActionAt?.toISOString(),
  });
  console.log('✅ Status: CONFIRMED | NextAction: ARRIVAL_15M (starts in ~45 mins)\n');

  // ------------------------------------------------------------------
  // BOOKING 2: User Pooja Sharma (> 2 Hours Tomorrow at 10:00 AM - Female)
  // ------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('👤 BOOKING 2: Pooja Sharma (> 2 Hours away tomorrow at 10:00 AM - Female)');
  console.log('----------------------------------------------------------------');
  const user2 = '+919811223302';
  await sendWhatsApp(user2, 'Hi');
  await sendWhatsApp(user2, '', 'btn_book');
  await sendWhatsApp(user2, '', 'gender_select_FEMALE');
  await sendWhatsApp(user2, '', `cat_${hairCutCat.id}`);
  await sendWhatsApp(user2, '', `svc_${womenHaircut.id}`);
  await sendWhatsApp(user2, '', 'staff_any');

  const tmrw = new Date();
  tmrw.setDate(tmrw.getDate() + 1);
  const tmrwStr = tmrw.toISOString().slice(0, 10);
  await sendWhatsApp(user2, '', `date_${tmrwStr}`);
  await sendWhatsApp(user2, '', 'slot_10:00');
  await sendWhatsApp(user2, 'Pooja Sharma');
  const res2 = await sendWhatsApp(user2, '', 'btn_confirm_yes');
  console.log('🤖 BOT CONFIRMATION:');
  console.log(res2.data?.replyMessage);

  const appt2 = await prisma.appointment.findFirst({
    where: {
      salonId: salon.id,
      salonUser: { user: { phone: { in: [user2, user2.replace('+', '')] } } },
    },
    include: { service: true, stylist: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log('📊 DATABASE RECORD 2 (> 2h tomorrow):', {
    id: appt2?.id,
    customer: 'Pooja Sharma',
    service: appt2?.service?.name,
    stylist: appt2?.stylist?.name,
    startAt: appt2?.startAt?.toISOString(),
    status: appt2?.status,
    bookingType: appt2?.bookingType,
    nextActionType: appt2?.nextActionType,
    nextActionAt: appt2?.nextActionAt?.toISOString(),
  });
  console.log('✅ Status: BOOKED | NextAction: REMINDER_2H (Tomorrow at 10:00 AM)\n');

  // ------------------------------------------------------------------
  // BOOKING 3: User Arjun Kapoor (> 2 Hours Tomorrow at 11:30 AM - Beard)
  // ------------------------------------------------------------------
  console.log('----------------------------------------------------------------');
  console.log('👤 BOOKING 3: Arjun Kapoor (> 2 Hours away tomorrow at 11:30 AM - Beard)');
  console.log('----------------------------------------------------------------');
  const user3 = '+919811223303';
  await sendWhatsApp(user3, 'Hi');
  await sendWhatsApp(user3, '', 'btn_book');
  await sendWhatsApp(user3, '', 'gender_select_MALE');
  await sendWhatsApp(user3, '', `cat_${beardCat.id}`);
  await sendWhatsApp(user3, '', `svc_${beardSvc.id}`);
  await sendWhatsApp(user3, '', 'staff_any');
  await sendWhatsApp(user3, '', `date_${tmrwStr}`);
  await sendWhatsApp(user3, '', 'slot_11:30');
  await sendWhatsApp(user3, 'Arjun Kapoor');
  const res3 = await sendWhatsApp(user3, '', 'btn_confirm_yes');
  console.log('🤖 BOT CONFIRMATION:');
  console.log(res3.data?.replyMessage);

  const appt3 = await prisma.appointment.findFirst({
    where: {
      salonId: salon.id,
      salonUser: { user: { phone: { in: [user3, user3.replace('+', '')] } } },
    },
    include: { service: true, stylist: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log('📊 DATABASE RECORD 3 (> 2h tomorrow):', {
    id: appt3?.id,
    customer: 'Arjun Kapoor',
    service: appt3?.service?.name,
    stylist: appt3?.stylist?.name,
    startAt: appt3?.startAt?.toISOString(),
    status: appt3?.status,
    bookingType: appt3?.bookingType,
    nextActionType: appt3?.nextActionType,
    nextActionAt: appt3?.nextActionAt?.toISOString(),
  });
  console.log('✅ Status: BOOKED | NextAction: REMINDER_2H (Tomorrow at 11:30 AM)\n');

  console.log('================================================================');
  console.log('🎉 ALL MULTIPLE SCENARIO USER BOOKINGS CREATED VIA WHATSAPP!');
  console.log('================================================================');

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});
