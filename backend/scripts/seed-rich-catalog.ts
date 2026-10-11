import { PrismaClient, ServiceGender, ServiceStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function seedRichCatalog() {
  const salon = await prisma.salon.findFirst();
  if (!salon) {
    console.error('No salon found!');
    return;
  }
  const salonId = salon.id;
  console.log(`Using salon: ${salon.name} (${salonId})`);

  // 1. Categories
  const catNames = [
    'Hair & Styling',
    'Beard & Shaving',
    'Facial & Skin Care',
    'Spa & Massage',
    'Nails & Beauty',
  ];

  const catMap: Record<string, string> = {};

  // Rename 'hair Cur' to 'Hair & Styling' if exists
  const oldHair = await prisma.serviceCategory.findFirst({
    where: { salonId, name: 'hair Cur' },
  });
  if (oldHair) {
    const updated = await prisma.serviceCategory.update({
      where: { id: oldHair.id },
      data: { name: 'Hair & Styling' },
    });
    catMap['Hair & Styling'] = updated.id;
  }

  for (const name of catNames) {
    if (catMap[name]) continue;
    let cat = await prisma.serviceCategory.findFirst({
      where: { salonId, name },
    });
    if (!cat) {
      cat = await prisma.serviceCategory.create({
        data: { salonId, name },
      });
    }
    catMap[name] = cat.id;
  }

  // 2. Services with diverse genders
  const servicesToCreate = [
    // Hair & Styling
    {
      name: "Men's Classic Haircut",
      category: 'Hair & Styling',
      durationMinutes: 30,
      price: 250,
      targetGender: ServiceGender.MALE,
    },
    {
      name: "Women's Layered Cut & Blowdry",
      category: 'Hair & Styling',
      durationMinutes: 45,
      price: 650,
      targetGender: ServiceGender.FEMALE,
    },
    {
      name: 'Kids Haircut & Styling',
      category: 'Hair & Styling',
      durationMinutes: 25,
      price: 180,
      targetGender: ServiceGender.KIDS,
    },
    {
      name: 'Keratin Smooth Treatment',
      category: 'Hair & Styling',
      durationMinutes: 90,
      price: 2200,
      targetGender: ServiceGender.UNISEX,
    },

    // Beard & Shaving
    {
      name: 'Royal Shave & Hot Towel',
      category: 'Beard & Shaving',
      durationMinutes: 30,
      price: 300,
      targetGender: ServiceGender.MALE,
    },
    {
      name: 'Beard Trim & Precision Shape',
      category: 'Beard & Shaving',
      durationMinutes: 20,
      price: 200,
      targetGender: ServiceGender.MALE,
    },

    // Facial & Skin Care
    {
      name: 'Deep Cleansing Charcoal Facial',
      category: 'Facial & Skin Care',
      durationMinutes: 45,
      price: 800,
      targetGender: ServiceGender.UNISEX,
    },
    {
      name: 'Bridal Glow Gold Facial',
      category: 'Facial & Skin Care',
      durationMinutes: 60,
      price: 1500,
      targetGender: ServiceGender.FEMALE,
    },
    {
      name: 'Anti-Tan Detox Cleanse',
      category: 'Facial & Skin Care',
      durationMinutes: 30,
      price: 500,
      targetGender: ServiceGender.UNISEX,
    },

    // Spa & Massage
    {
      name: 'Aromatherapy Head Massage',
      category: 'Spa & Massage',
      durationMinutes: 30,
      price: 400,
      targetGender: ServiceGender.UNISEX,
    },
    {
      name: 'Deep Tissue Shoulder & Back Massage',
      category: 'Spa & Massage',
      durationMinutes: 45,
      price: 900,
      targetGender: ServiceGender.UNISEX,
    },

    // Nails & Beauty
    {
      name: 'Classic Manicure & Pedicure',
      category: 'Nails & Beauty',
      durationMinutes: 45,
      price: 600,
      targetGender: ServiceGender.FEMALE,
    },
    {
      name: 'Gel Nail Art & Polish',
      category: 'Nails & Beauty',
      durationMinutes: 40,
      price: 800,
      targetGender: ServiceGender.FEMALE,
    },
    {
      name: 'Kids Gentle Nail Art',
      category: 'Nails & Beauty',
      durationMinutes: 20,
      price: 250,
      targetGender: ServiceGender.KIDS,
    },
  ];

  for (const s of servicesToCreate) {
    const existing = await prisma.service.findFirst({
      where: { salonId, name: s.name },
    });
    if (!existing) {
      await prisma.service.create({
        data: {
          salonId,
          categoryId: catMap[s.category],
          name: s.name,
          durationMinutes: s.durationMinutes,
          price: s.price,
          targetGender: s.targetGender,
          status: ServiceStatus.ACTIVE,
        },
      });
      console.log(`Created service: ${s.name} [${s.targetGender}] in ${s.category}`);
    } else {
      await prisma.service.update({
        where: { id: existing.id },
        data: {
          categoryId: catMap[s.category],
          targetGender: s.targetGender,
          durationMinutes: s.durationMinutes,
          price: s.price,
        },
      });
      console.log(`Updated service: ${s.name} [${s.targetGender}]`);
    }
  }

  // Also update existing 'Hair Cut' and 'Beard & Shaving' if present
  const oldHairCut = await prisma.service.findFirst({
    where: { salonId, name: 'Hair Cut' },
  });
  if (oldHairCut && catMap['Hair & Styling']) {
    await prisma.service.update({
      where: { id: oldHairCut.id },
      data: {
        categoryId: catMap['Hair & Styling'],
        targetGender: ServiceGender.MALE,
      },
    });
  }

  const oldBeard = await prisma.service.findFirst({
    where: { salonId, name: 'Beard & Shaving' },
  });
  if (oldBeard && catMap['Beard & Shaving']) {
    await prisma.service.update({
      where: { id: oldBeard.id },
      data: {
        categoryId: catMap['Beard & Shaving'],
        targetGender: ServiceGender.MALE,
      },
    });
  }

  const allCats = await prisma.serviceCategory.findMany({ where: { salonId } });
  const allSrvs = await prisma.service.findMany({ where: { salonId } });
  console.log(`\n🎉 Success! Total Categories: ${allCats.length}, Total Services: ${allSrvs.length}`);
}

seedRichCatalog()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
