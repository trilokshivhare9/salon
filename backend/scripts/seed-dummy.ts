import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const adminPhone = '7999817743';
  const admin = await prisma.admin.findFirst({
    where: { phone: adminPhone }
  });

  if (!admin) {
    console.error("Admin not found with phone " + adminPhone);
    return;
  }

  let salon = null;
  if (admin.salonId) {
    salon = await prisma.salon.findFirst({ where: { id: admin.salonId } });
  } else {
    salon = await prisma.salon.findFirst({ where: { createdByAdminId: admin.id } });
  }

  if (!salon) {
    console.error("Salon not found for admin " + admin.id);
    return;
  }

  console.log("Found salon:", salon.id);

  // create a service
  const service = await prisma.service.create({
    data: {
      salonId: salon.id,
      name: 'Premium Haircut',
      price: 50.00,
      durationMinutes: 45,
    }
  });

  // Create a user (customer)
  let customer = await prisma.user.findFirst({ where: { phone: '1234567890' } });
  if (!customer) {
    customer = await prisma.user.create({
      data: {
        name: 'John Doe',
        phone: '1234567890'
      }
    });
  }
  
  let salonUser = await prisma.salonUser.findFirst({
      where: { salonId: salon.id, userId: customer.id }
  });

  if (!salonUser) {
    salonUser = await prisma.salonUser.create({
        data: {
            salonId: salon.id,
            userId: customer.id
        }
    });
  }

  // Find a stylist
  let stylist = await prisma.stylist.findFirst({
    where: { salonId: salon.id, name: 'Trilok Shivhare' }
  });

  if (!stylist) {
    stylist = await prisma.stylist.create({
      data: {
        salonId: salon.id,
        name: 'Trilok Shivhare',
        phone: '+917747032315'
      }
    });
  }

  // Set StylistWorkingHours
  const days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'] as any[];
  for (const day of days) {
      const workingHourData = {
          startTime: '09:00',
          endTime: '21:00',
          isWorking: true,
          hasBreakOverride: true,
          breaks: [
              { startTime: '13:00', endTime: '14:00', title: 'Lunch Break' }
          ]
      };
      
      const existing = await prisma.stylistWorkingHours.findUnique({
          where: { stylistId_dayOfWeek: { stylistId: stylist.id, dayOfWeek: day } }
      });

      if (existing) {
          await prisma.stylistWorkingHours.update({
              where: { id: existing.id },
              data: workingHourData
          });
      } else {
          await prisma.stylistWorkingHours.create({
              data: {
                  stylistId: stylist.id,
                  dayOfWeek: day,
                  ...workingHourData
              }
          });
      }
  }

  // delete absences to remove "On Leave (Full Day)"
  await prisma.stylistAbsence.deleteMany({
      where: { stylistId: stylist.id }
  });

  // delete today's appointments for this stylist
  const todayStart = new Date();
  todayStart.setHours(0,0,0,0);
  const todayEnd = new Date();
  todayEnd.setHours(23,59,59,999);

  await prisma.appointment.deleteMany({
      where: {
          stylistId: stylist.id,
          appointmentDate: {
              gte: todayStart,
              lte: todayEnd
          }
      }
  });

  // Create an appointment today at 10:00 AM
  const todayDate = new Date();
  todayDate.setHours(0, 0, 0, 0);

  const t1 = new Date();
  t1.setHours(10, 0, 0, 0);
  
  await prisma.appointment.create({
    data: {
      appointmentNumber: 'APT-' + Math.floor(Math.random() * 1000000),
      salonId: salon.id,
      salonUserId: salonUser.id,
      stylistId: stylist.id,
      serviceId: service.id,
      serviceNameSnapshot: service.name,
      durationMinutes: service.durationMinutes,
      price: service.price,
      status: 'CONFIRMED',
      startAt: t1,
      endAt: new Date(t1.getTime() + service.durationMinutes * 60000),
      appointmentDate: todayDate
    }
  });

  // another one at 11:30 AM
  const t2 = new Date();
  t2.setHours(11, 30, 0, 0);

  await prisma.appointment.create({
    data: {
      appointmentNumber: 'APT-' + Math.floor(Math.random() * 1000000),
      salonId: salon.id,
      salonUserId: salonUser.id,
      stylistId: stylist.id,
      serviceId: service.id,
      serviceNameSnapshot: service.name,
      durationMinutes: service.durationMinutes,
      price: service.price,
      status: 'IN_SERVICE',
      startAt: t2,
      endAt: new Date(t2.getTime() + service.durationMinutes * 60000),
      appointmentDate: todayDate
    }
  });

  // another one at 15:00 PM (Done)
  const t3 = new Date();
  t3.setHours(15, 0, 0, 0);

  await prisma.appointment.create({
    data: {
      appointmentNumber: 'APT-' + Math.floor(Math.random() * 1000000),
      salonId: salon.id,
      salonUserId: salonUser.id,
      stylistId: stylist.id,
      serviceId: service.id,
      serviceNameSnapshot: service.name,
      durationMinutes: service.durationMinutes,
      price: service.price,
      status: 'COMPLETED',
      startAt: t3,
      endAt: new Date(t3.getTime() + service.durationMinutes * 60000),
      appointmentDate: todayDate
    }
  });

  console.log("Successfully seeded dummy data!");
}

main().catch(console.error).finally(() => prisma.$disconnect());
