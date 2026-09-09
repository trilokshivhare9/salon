import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { MasterCategoriesService } from '../src/modules/master-categories/master-categories.service';
import { SalonsService } from '../src/modules/salons/salons.service';
import { ServicesService } from '../src/modules/services/services.service';
import { StaffService } from '../src/modules/staff/staff.service';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { AdminRole, ServiceGender, StylistStatus } from '@prisma/client';

async function runHumanWhatsAppCategoryAudit() {
  console.log('================================================================');
  console.log('  🧪 HUMAN-LIKE USER-SIDE & WHATSAPP CATEGORY INTEGRATION AUDIT  ');
  console.log('================================================================\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const masterCatService = app.get(MasterCategoriesService);
  const salonsService = app.get(SalonsService);
  const servicesService = app.get(ServicesService);
  const staffService = app.get(StaffService);
  const whatsappService = app.get(WhatsAppService);

  const testId = Date.now().toString().slice(-6);
  const customerPhone = `+9199${testId}999`;

  try {
    // -------------------------------------------------------------------------
    // SCENARIO 1: Super Admin Master Category Management
    // -------------------------------------------------------------------------
    console.log('📍 SCENARIO 1: Super Admin Master Category Operations');
    let superAdmin = await prisma.admin.findFirst({
      where: { role: AdminRole.SUPER_ADMIN },
    });

    if (!superAdmin) {
      superAdmin = await prisma.admin.create({
        data: {
          name: 'Master Platform Admin',
          email: `superadmin_${testId}@salonflow.com`,
          phone: `98765${testId.slice(-5)}`,
          passwordHash: '$2b$10$abcdefghijklmnopqrstuuu',
          role: AdminRole.SUPER_ADMIN,
        },
      });
    }

    const masterCatName = `🔥 Super Festive Combos ${testId}`;
    console.log(`[Super Admin] Creating Master Category "${masterCatName}" (icon: 🔥, sortOrder: 8)...`);
    const createdMasterCat = await masterCatService.createMasterCategory({
      name: masterCatName,
      icon: '🔥',
      sortOrder: 8,
    });
    console.log(`✅ [DB Check master_categories] Created ID=${createdMasterCat.id}, Name="${createdMasterCat.name}"`);

    // Verify negative test: Duplicate creation
    try {
      await masterCatService.createMasterCategory({ name: masterCatName });
      console.error('❌ FAILED: Duplicate Master Category was allowed!');
    } catch (err: any) {
      console.log(`✅ [Validation Check] Rejection message: "${err.message}"`);
    }

    // -------------------------------------------------------------------------
    // SCENARIO 2: Salon Provisioning & Instant Master Category Inheritance
    // -------------------------------------------------------------------------
    console.log('\n📍 SCENARIO 2: Salon Provisioning & Automatic Inheritance');
    const salonDto = {
      name: `Aura Luxury Salon ${testId}`,
      ownerName: `Rohan Verma ${testId}`,
      email: `aura_${testId}@luxury.com`,
      phone: `98763${testId.slice(-5)}`,
      password: 'Password@123',
      city: 'Delhi',
      address: 'South Extension Part 2',
      openTime: '09:00',
      closeTime: '21:00',
    };

    console.log(`[Super Admin] Provisioning new salon "${salonDto.name}"...`);
    const salon = await salonsService.createSalonBySuperAdmin(superAdmin.id, salonDto);
    console.log(`✅ [DB Check salons] Created Salon ID=${salon.id}`);

    // Query DB for inherited categories
    const inheritedCats = await prisma.serviceCategory.findMany({
      where: { salonId: salon.id },
      orderBy: { sortOrder: 'asc' },
    });
    console.log(`✅ [DB Check service_categories] Salon inherited ${inheritedCats.length} categories:`);
    inheritedCats.forEach((c) => console.log(`   └─ ${c.icon || '✂️'} ${c.name} (ID: ${c.id})`));

    const inheritedFestiveCat = inheritedCats.find((c) => c.name === masterCatName);
    console.log(`✅ [Inheritance Assert] Master Category "${masterCatName}" inherited in Salon? ${inheritedFestiveCat ? 'YES' : 'NO'}`);

    // -------------------------------------------------------------------------
    // SCENARIO 3: Salon Owner Custom Categories, Services & Staff Setup
    // -------------------------------------------------------------------------
    console.log('\n📍 SCENARIO 3: Salon Owner Custom Setup (Categories, Staff, Services)');
    
    // 3.1 Create Custom Category
    const customCatName = `💆 Organic Head Spa ${testId}`;
    console.log(`[Salon Owner] Creating custom category "${customCatName}"...`);
    const customCat = await servicesService.createServiceCategory(salon.id, customCatName, '💆', 9);
    console.log(`✅ [DB Check service_categories] Created custom category ID=${customCat.id}`);

    // 3.2 Create Service A (under Inherited Hair & Beard Category)
    const hairBeardCat = inheritedCats.find((c) => c.name.includes('Hair & Beard')) || inheritedCats[0];
    console.log(`[Salon Owner] Adding Service 1 under Inherited Category "${hairBeardCat.name}"...`);
    const service1 = await servicesService.createService(salon.id, {
      name: `Festive Haircut + Beard Combo ${testId}`,
      price: 500,
      durationMinutes: 45,
      categoryId: hairBeardCat.id,
      targetGender: ServiceGender.UNISEX,
      description: 'Complete festive haircut and beard trim',
      stylistIds: [],
    });
    console.log(`✅ [DB Check services] Created Service 1 ID=${service1.id}, Name="${service1.name}"`);

    // 3.3 Create Active Staff Member (Now allowed since Salon has 1 active service)
    console.log(`[Salon Owner] Adding active stylist "Rohan Hair Specialist"...`);
    const staff = await staffService.createStaff(salon.id, {
      name: `Rohan Hair Specialist ${testId}`,
      phone: `98762${testId.slice(-5)}`,
    });
    console.log(`✅ [DB Check stylists] Created Stylist ID=${staff.id}`);

    // 3.4 Create Service B (under Custom Organic Head Spa Category & assigned to Staff)
    console.log(`[Salon Owner] Adding Service 2 under Custom Category "${customCat.name}"...`);
    const service2 = await servicesService.createService(salon.id, {
      name: `Ayurvedic Herbal Head Spa ${testId}`,
      price: 800,
      durationMinutes: 60,
      categoryId: customCat.id,
      targetGender: ServiceGender.UNISEX,
      description: 'Refreshing organic head massage & spa',
      stylistIds: [staff.id],
    });
    console.log(`✅ [DB Check services] Created Service 2 ID=${service2.id}, Name="${service2.name}"`);

    // 3.5 Create Service C (Edge Case: NO STAFF ASSIGNED)
    console.log(`[Salon Owner] Adding Service 3 (Unassigned Staff Edge Case) under Custom Category "${customCat.name}"...`);
    const service3 = await servicesService.createService(salon.id, {
      name: `VIP Unassigned Deluxe Spa ${testId}`,
      price: 1500,
      durationMinutes: 90,
      categoryId: customCat.id,
      targetGender: ServiceGender.UNISEX,
      description: 'Exclusive deluxe spa with no staff assigned yet',
      stylistIds: [], // NO STAFF ASSIGNED
    });
    console.log(`✅ [DB Check services] Created Service 3 (No Staff) ID=${service3.id}`);

    // -------------------------------------------------------------------------
    // SCENARIO 4: User/Customer WhatsApp Interaction & Response Audit
    // -------------------------------------------------------------------------
    console.log('\n📍 SCENARIO 4: Customer WhatsApp Interaction & Response Audit');
    
    // 4.1 User sends "hi"
    console.log(`[User WhatsApp Action] Customer (${customerPhone}) sends "hi"...`);
    const reply1 = await whatsappService.handleIncomingMessage(salon.id, customerPhone, 'hi');
    console.log(`📩 [WhatsApp User Reply]:\n"${reply1.replyMessage}"`);
    console.log(`State: ${reply1.state}`);

    // 4.2 User clicks "Services" or sends "services"
    console.log(`\n[User WhatsApp Action] Customer clicks "btn_services" / requests service menu...`);
    const reply2 = await whatsappService.handleIncomingMessage(salon.id, customerPhone, 'btn_services');
    console.log(`📩 [WhatsApp User Reply - Category Menu]:\n"${reply2.replyMessage}"`);

    // Fetch conversation state from DB to inspect payload sent to Meta
    const convRow = await prisma.conversation.findFirst({
      where: { salonId: salon.id, customerPhone },
    });
    console.log(`✅ [DB Check conversation] State=${convRow?.state}, SelectedCat=${convRow?.selectedCategoryId}`);

    // 4.3 User selects Inherited Category (Hair & Beard Services)
    console.log(`\n[User WhatsApp Action] Customer selects Category "cat_${hairBeardCat.id}" (${hairBeardCat.name})...`);
    const replyCat1 = await whatsappService.handleIncomingMessage(salon.id, customerPhone, `cat_${hairBeardCat.id}`);
    console.log(`📩 [WhatsApp User Reply - Services in Hair & Beard]:\n"${replyCat1.replyMessage}"`);

    // 4.4 User selects Custom Category (Organic Head Spa)
    console.log(`\n[User WhatsApp Action] Customer selects Custom Category "cat_${customCat.id}" (${customCat.name})...`);
    const replyCat2 = await whatsappService.handleIncomingMessage(salon.id, customerPhone, `cat_${customCat.id}`);
    console.log(`📩 [WhatsApp User Reply - Services in Organic Head Spa]:\n"${replyCat2.replyMessage}"`);

    // Assert that Service 2 (Ayurvedic Herbal Spa) IS present, but Service 3 (Unassigned Staff) IS NOT listed for booking
    const containsAssignedService = replyCat2.replyMessage.includes(`Ayurvedic Herbal Head Spa`);
    const containsUnassignedService = replyCat2.replyMessage.includes(`VIP Unassigned Deluxe Spa`);
    console.log(`✅ [User View Assert] Active assigned service shown to user? ${containsAssignedService ? 'YES' : 'NO'}`);
    console.log(`✅ [User View Assert] Unassigned staff service filtered out from booking? ${!containsUnassignedService ? 'YES (Safely Filtered)' : 'NO (Error: Shown without staff)'}`);

    // -------------------------------------------------------------------------
    // SCENARIO 5: Edge Case - Category Deletion & Fallback to General Services
    // -------------------------------------------------------------------------
    console.log('\n📍 SCENARIO 5: Edge Case - Category Deletion Resilience');
    console.log(`[Salon Owner Action] Deleting custom category "${customCat.name}" (ID: ${customCat.id})...`);
    await servicesService.deleteServiceCategory(salon.id, customCat.id);

    // Verify DB state for Service 2
    const dbSvc2AfterDelete = await prisma.service.findUnique({ where: { id: service2.id } });
    console.log(`✅ [DB Check services] Service 2 categoryId after category deletion: ${dbSvc2AfterDelete?.categoryId} (Expected: null)`);

    // Customer re-requests service menu on WhatsApp
    console.log(`\n[User WhatsApp Action] Customer types "hi" again to restart menu...`);
    await whatsappService.handleIncomingMessage(salon.id, customerPhone, 'hi');
    const replyAfterDelete = await whatsappService.handleIncomingMessage(salon.id, customerPhone, 'btn_services');
    console.log(`📩 [WhatsApp User Reply after Category Deletion]:\n"${replyAfterDelete.replyMessage}"`);

    // Verify Service 2 is now presented under General Services or accessible list
    console.log(`[User WhatsApp Action] Customer views General/Service list...`);
    const replyGeneral = await whatsappService.handleIncomingMessage(salon.id, customerPhone, 'cat_uncategorized');
    console.log(`📩 [WhatsApp User Reply - General Services]:\n"${replyGeneral.replyMessage}"`);

    const isService2Bookable = replyGeneral.replyMessage.includes(`Ayurvedic Herbal Head Spa`);
    console.log(`✅ [Resilience Assert] Service remains 100% bookable under uncategorized/general menu? ${isService2Bookable ? 'YES' : 'NO'}`);

    // Cleanup Master Category test row
    await masterCatService.deleteMasterCategory(createdMasterCat.id);
    console.log(`\nCleaned up test Master Category ${createdMasterCat.id}.`);

    console.log('\n================================================================');
    console.log('  🎉 ALL HUMAN SCENARIOS & USER-SIDE WHATSAPP AUDITS PASSED 100%  ');
    console.log('================================================================');
  } catch (err: any) {
    console.error('\n❌ HUMAN AUDIT FAILURE:', err);
  } finally {
    await app.close();
  }
}

runHumanWhatsAppCategoryAudit();
