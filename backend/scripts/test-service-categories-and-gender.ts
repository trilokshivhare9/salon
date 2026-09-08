import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { ServicesService } from '../src/modules/services/services.service';
import { WhatsAppService } from '../src/modules/whatsapp/whatsapp.service';
import { ServiceGender, ConversationState, AdminRole, AdminStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

async function runCategoryAndGenderTestSuite() {
  console.log('🚀 Starting 2-Tier Service Category & Gender Profiling Suite...\n');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const servicesService = app.get(ServicesService);
  const whatsAppService = app.get(WhatsAppService);

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`  ✅ PASSED: ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ FAILED: ${testName} - ${detail || 'Assertion failed'}`);
      failed++;
    }
  }

  try {
    // 1. SETUP TEST FIXTURES
    const passwordHash = await bcrypt.hash('Password123!', 10);
    let superAdmin = await prisma.admin.findFirst({ where: { role: AdminRole.SUPER_ADMIN } });
    if (!superAdmin) {
      superAdmin = await prisma.admin.create({
        data: {
          name: 'Category Test Admin',
          email: `cat-admin-${Date.now()}@test.com`,
          passwordHash,
          role: AdminRole.SUPER_ADMIN,
          status: AdminStatus.ACTIVE,
        },
      });
    }

    const salon = await prisma.salon.create({
      data: {
        createdByAdminId: superAdmin.id,
        name: 'Unisex Category Salon',
        slug: `unisex-salon-${Date.now()}`,
        email: `unisex-${Date.now()}@test.com`,
        phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
        status: 'ACTIVE',
        timezone: 'Asia/Kolkata',
      },
    });

    const stylist = await prisma.stylist.create({
      data: {
        salonId: salon.id,
        name: 'Master Stylist Alex',
        phone: `+91${Math.floor(1000000000 + Math.random() * 9000000000)}`,
        status: 'ACTIVE',
      },
    });

    // 2. CREATE CATEGORIES
    const hairCat = await servicesService.createServiceCategory(salon.id, 'Hair Care & Styling', '✂️', 1);
    const skinCat = await servicesService.createServiceCategory(salon.id, 'Skin & Facials', '✨', 2);

    assert(hairCat && hairCat.name === 'Hair Care & Styling', 'Create Service Category');

    const categories = await servicesService.getServiceCategories(salon.id);
    assert(categories.length === 2, 'Get Service Categories List', `Got ${categories.length} categories`);

    // 3. CREATE SERVICES WITH CATEGORIES AND GENDER TARGETS
    const mensHaircut = await servicesService.createService(salon.id, {
      name: "Men's Executive Haircut",
      price: 350,
      durationMinutes: 30,
      categoryId: hairCat.id,
      targetGender: ServiceGender.MALE,
    });

    const womensStyling = await servicesService.createService(salon.id, {
      name: "Women's Blowdry & Styling",
      price: 800,
      durationMinutes: 45,
      categoryId: hairCat.id,
      targetGender: ServiceGender.FEMALE,
    });

    const unisexFacial = await servicesService.createService(salon.id, {
      name: 'Glowing Herbal Facial',
      price: 1200,
      durationMinutes: 60,
      categoryId: skinCat.id,
      targetGender: ServiceGender.UNISEX,
    });

    const kidsHaircut = await servicesService.createService(salon.id, {
      name: 'Kids Fun Haircut',
      price: 250,
      durationMinutes: 30,
      categoryId: hairCat.id,
      targetGender: ServiceGender.KIDS,
    });

    assert(!!mensHaircut && mensHaircut.targetGender === ServiceGender.MALE, 'Create Service with Category & MALE Target');
    assert(!!womensStyling && womensStyling.targetGender === ServiceGender.FEMALE, 'Create Service with Category & FEMALE Target');

    // 4. WHATSAPP BOOKING FLOW TEST: STEP 1 - CATEGORY SELECTION
    const testCustomerPhone = `+9199${Math.floor(10000000 + Math.random() * 90000000)}`;

    const res1 = await whatsAppService.handleIncomingMessage(salon.id, testCustomerPhone, 'btn_book');
    assert(res1.state === ConversationState.SELECT_CATEGORY, 'WhatsApp Booking triggers SELECT_CATEGORY state');

    // Verify conversation record in DB
    let conv = await prisma.conversation.findUnique({
      where: { salonId_customerPhone: { salonId: salon.id, customerPhone: testCustomerPhone } },
    });
    assert(conv?.state === ConversationState.SELECT_CATEGORY, 'Conversation state saved as SELECT_CATEGORY in DB');

    // 5. WHATSAPP BOOKING FLOW TEST: STEP 2 - GENDER SWITCH TO FEMALE
    const res2 = await whatsAppService.handleIncomingMessage(salon.id, testCustomerPhone, 'gender_select_FEMALE');
    conv = await prisma.conversation.findUnique({
      where: { salonId_customerPhone: { salonId: salon.id, customerPhone: testCustomerPhone } },
    });

    assert(conv?.tempBookingGender === ServiceGender.FEMALE, 'Gender switcher updates tempBookingGender to FEMALE');

    // 6. WHATSAPP BOOKING FLOW TEST: STEP 3 - SELECT CATEGORY (Hair Care)
    const res3 = await whatsAppService.handleIncomingMessage(salon.id, testCustomerPhone, `cat_${hairCat.id}`);
    assert(res3.state === ConversationState.SELECT_SERVICE, 'Category selection advances state to SELECT_SERVICE');
    assert(res3.metadata?.services?.length === 1, 'FEMALE filter shows only Women Blowdry (1 service in Hair Cat)', `Got ${res3.metadata?.services?.length} services`);
    assert(res3.metadata?.services[0]?.name === "Women's Blowdry & Styling", 'Returned service is Women Blowdry');

    // 7. WHATSAPP BOOKING FLOW TEST: STEP 4 - GENDER SWITCH TO MALE & VIEW HAIR CAT
    const res4 = await whatsAppService.handleIncomingMessage(salon.id, testCustomerPhone, 'gender_select_MALE');
    assert(res4.metadata?.services?.length === 1, 'MALE filter shows Men Executive Haircut (1 service in Hair Cat)');
    assert(res4.metadata?.services[0]?.name === "Men's Executive Haircut", 'Returned service is Men Executive Haircut');

    // 8. WHATSAPP BOOKING FLOW TEST: STEP 5 - CHOOSE SERVICE TO ADVANCE
    const res5 = await whatsAppService.handleIncomingMessage(salon.id, testCustomerPhone, `svc_${mensHaircut.id}`);
    conv = await prisma.conversation.findUnique({
      where: { salonId_customerPhone: { salonId: salon.id, customerPhone: testCustomerPhone } },
    });
    assert(conv?.selectedServiceId === mensHaircut.id, 'Service selection stores selectedServiceId');
    assert(conv?.state === ConversationState.SELECT_DATE, 'Service selection advances flow to SELECT_DATE state');

    // 9. CLEANUP / CASCADE DELETION TEST FOR CATEGORY
    await servicesService.deleteServiceCategory(salon.id, hairCat.id);
    const updatedService = await prisma.service.findUnique({ where: { id: mensHaircut.id } });
    assert(updatedService?.categoryId === null, 'Category deletion unbinds category (onDelete: SetNull)');

    // Clean test fixtures
    await prisma.salon.delete({ where: { id: salon.id } });

    console.log(`\n🎉 Test Suite Completed: ${passed} Passed, ${failed} Failed`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (err: any) {
    console.error('💥 Test suite unexpected error:', err);
    process.exit(1);
  }
}

runCategoryAndGenderTestSuite();
