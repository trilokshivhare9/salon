import { PrismaClient, ServiceStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function testServicesCategoryUnit() {
  console.log('🧪 Starting Direct Service Category Auto-Creation Test via Prisma...\n');

  let salon = await prisma.salon.findFirst();

  if (!salon) {
    console.log('No salon found in current DB.');
    process.exit(1);
  }

  const customCatName = 'VIP Spa ' + Date.now().toString().slice(-4);
  console.log(`Testing custom category auto-creation for category "${customCatName}" on salon "${salon.id}"...`);

  // Simulate what ServicesService.createService does:
  let resolvedCategoryId: string | null = null;
  let cat = await prisma.serviceCategory.findFirst({
    where: { salonId: salon.id, name: { equals: customCatName, mode: 'insensitive' } },
  });

  if (!cat) {
    cat = await prisma.serviceCategory.create({
      data: {
        salonId: salon.id,
        name: customCatName,
        icon: '✂️',
        sortOrder: 0,
      },
    });
  }
  resolvedCategoryId = cat.id;

  const service = await prisma.service.create({
    data: {
      salonId: salon.id,
      name: 'VIP Facial & Hair Spa',
      price: 1200,
      durationMinutes: 45,
      category: customCatName,
      categoryId: resolvedCategoryId,
      targetGender: 'UNISEX',
      status: ServiceStatus.ACTIVE,
    },
    include: { serviceCategory: true },
  });

  console.log('\n✅ Created Service Record:');
  console.log('   ID:', service.id);
  console.log('   Name:', service.name);
  console.log('   Category Text:', service.category);
  console.log('   Linked Category ID:', service.categoryId);
  console.log('   Linked Category Object Name:', service.serviceCategory?.name);

  if (service.categoryId && service.serviceCategory?.name === customCatName) {
    console.log('\n🎉 SUCCESS: Custom category was auto-created in ServiceCategory DB table and linked to Service record!');
  } else {
    console.error('\n❌ FAILURE: Custom category linking failed!');
    process.exit(1);
  }
}

testServicesCategoryUnit()
  .then(() => prisma.$disconnect())
  .catch((err) => {
    console.error(err);
    prisma.$disconnect();
    process.exit(1);
  });
