import { PrismaClient, ServiceGender, ServiceStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding multiple services and categories...');

  // 1. Locate the active salon
  const salon = await prisma.salon.findFirst({
    where: { status: 'ACTIVE' },
    include: {
      stylists: { where: { status: 'ACTIVE' } },
    },
  });

  if (!salon) {
    console.error('❌ No active salon found in database.');
    process.exit(1);
  }

  console.log(`📍 Found Salon: "${salon.name}" (${salon.id}) with ${salon.stylists.length} active stylists.`);

  const stylists = salon.stylists;
  const getStylist = (namePart: string) => stylists.find((s) => s.name.toLowerCase().includes(namePart.toLowerCase()));

  // 2. Define Categories to create/ensure
  const categoriesDef = [
    { name: 'HairCut', icon: '✂️', sortOrder: 1 },
    { name: 'Beard & Shave', icon: '🪒', sortOrder: 2 },
    { name: 'Facial', icon: '✨', sortOrder: 3 },
    { name: 'Hair Color & Spa', icon: '💆', sortOrder: 4 },
    { name: 'Nails & Pedicure', icon: '💅', sortOrder: 5 },
    { name: 'Kids Styling', icon: '👶', sortOrder: 6 },
  ];

  const categoryMap = new Map<string, string>();

  for (const catDef of categoriesDef) {
    let cat = await prisma.serviceCategory.findFirst({
      where: { salonId: salon.id, name: { equals: catDef.name, mode: 'insensitive' } },
    });

    if (!cat) {
      cat = await prisma.serviceCategory.create({
        data: {
          salonId: salon.id,
          name: catDef.name,
          icon: catDef.icon,
          sortOrder: catDef.sortOrder,
        },
      });
      console.log(`  ➕ Created Category: ${cat.name}`);
    } else {
      cat = await prisma.serviceCategory.update({
        where: { id: cat.id },
        data: { icon: catDef.icon, sortOrder: catDef.sortOrder },
      });
      console.log(`  ✓ Updated Category: ${cat.name}`);
    }
    categoryMap.set(catDef.name.toUpperCase(), cat.id);
  }

  // 3. Define Diverse Services
  const servicesData = [
    // --- HairCut ---
    {
      name: "Men's Executive Haircut & Wash",
      category: 'HairCut',
      targetGender: ServiceGender.MALE,
      price: 450,
      durationMinutes: 45,
      description: 'Signature precision fade with refreshing clarifying scalp wash and cooling towel.',
      stylistNames: ['Aarav', 'Rohan'],
    },
    {
      name: "Women's Layered Cut & Blowdry",
      category: 'HairCut',
      targetGender: ServiceGender.FEMALE,
      price: 850,
      durationMinutes: 60,
      description: 'Customized layered haircut with volume bounce blowdry and heat protection serum.',
      stylistNames: ['Priya', 'Sneha'],
    },
    {
      name: 'Kids Fun Haircut',
      category: 'HairCut',
      targetGender: ServiceGender.KIDS,
      price: 300,
      durationMinutes: 30,
      description: 'Gentle, patient haircut styling tailored for kids with zero fuss.',
      stylistNames: ['Trilok', 'Ananya'],
    },
    {
      name: 'Classic Unisex Hair Trim',
      category: 'HairCut',
      targetGender: ServiceGender.UNISEX,
      price: 400,
      durationMinutes: 30,
      description: 'Split-ends cleanup and length maintenance trim suitable for all hair types.',
      stylistNames: [], // Unassigned
    },

    // --- Beard & Shave ---
    {
      name: 'Royal Beard Grooming & Hot Towel',
      category: 'Beard & Shave',
      targetGender: ServiceGender.MALE,
      price: 350,
      durationMinutes: 30,
      description: 'Sharp razor outline, organic beard oil massage, and soothing aromatic hot towel wrap.',
      stylistNames: ['Vikram', 'Karan'],
    },
    {
      name: 'Traditional Clean Shave',
      category: 'Beard & Shave',
      targetGender: ServiceGender.MALE,
      price: 250,
      durationMinutes: 30,
      description: 'Classic double-edge razor shave with rich botanical lather and cooling aftershave.',
      stylistNames: ['Arjun'],
    },

    // --- Facial ---
    {
      name: 'Deep Cleansing 24K Gold Facial',
      category: 'Facial',
      targetGender: ServiceGender.FEMALE,
      price: 1500,
      durationMinutes: 60,
      description: 'Brightening 24K gold radiance facial with ultrasonic blackhead extraction.',
      stylistNames: ['Pooja', 'Neha'],
    },
    {
      name: "Men's Active Detan Charcoal Facial",
      category: 'Facial',
      targetGender: ServiceGender.MALE,
      price: 950,
      durationMinutes: 45,
      description: 'Activated bamboo charcoal mask to lift environmental pollution and sun tan.',
      stylistNames: ['Aarav'],
    },
    {
      name: 'Hydra-Infusion Glow Therapy',
      category: 'Facial',
      targetGender: ServiceGender.UNISEX,
      price: 1800,
      durationMinutes: 60,
      description: 'Multi-step vortex water infusion for deep skin hydration and natural peptide glow.',
      stylistNames: ['Priya', 'Sneha'],
    },
    {
      name: 'Express Clean-Up & Herbal Mask',
      category: 'Facial',
      targetGender: ServiceGender.UNISEX,
      price: 600,
      durationMinutes: 30,
      description: 'Quick revitalizing exfoliation, steam, and pore-minimizing cooling aloe mask.',
      stylistNames: [], // Unassigned
    },

    // --- Hair Color & Spa ---
    {
      name: 'Balayage & Global Highlights',
      category: 'Hair Color & Spa',
      targetGender: ServiceGender.FEMALE,
      price: 3200,
      durationMinutes: 90,
      description: 'Hand-painted seamless sun-kissed gradient coloring with bond-repair treatment.',
      stylistNames: ['Sneha', 'Pooja'],
    },
    {
      name: 'Keratin Smooth & Argan Oil Spa',
      category: 'Hair Color & Spa',
      targetGender: ServiceGender.UNISEX,
      price: 2100,
      durationMinutes: 75,
      description: 'Intense frizz control, deep hair shaft protein repair, and head massage.',
      stylistNames: ['Ananya', 'Rohan'],
    },
    {
      name: "Men's Beard & Hair Color Touch-up",
      category: 'Hair Color & Spa',
      targetGender: ServiceGender.MALE,
      price: 700,
      durationMinutes: 45,
      description: 'Ammonia-free natural black/dark brown subtle grey coverage.',
      stylistNames: ['Vikram'],
    },

    // --- Nails & Pedicure ---
    {
      name: 'Luxury Gel Nail Art & Manicure',
      category: 'Nails & Pedicure',
      targetGender: ServiceGender.FEMALE,
      price: 1200,
      durationMinutes: 60,
      description: 'Cuticle restoration, hand massage, and designer UV gel polish artwork.',
      stylistNames: ['Neha'],
    },
    {
      name: 'Aromatherapy Foot Pedicure',
      category: 'Nails & Pedicure',
      targetGender: ServiceGender.UNISEX,
      price: 800,
      durationMinutes: 45,
      description: 'Warm sea salt bath, pumice callus removal, botanical scrub, and calf massage.',
      stylistNames: ['Priya', 'Arjun'],
    },
    {
      name: 'Express Quick Manicure',
      category: 'Nails & Pedicure',
      targetGender: ServiceGender.UNISEX,
      price: 450,
      durationMinutes: 30,
      description: 'Neat nail shaping, cuticle push, buffing, and clear strengthening coat.',
      stylistNames: [], // Unassigned
    },

    // --- Kids Styling ---
    {
      name: 'Little Princess Braids & Hair Bow',
      category: 'Kids Styling',
      targetGender: ServiceGender.KIDS,
      price: 450,
      durationMinutes: 30,
      description: 'Dutch braids or French twists with colorful ribbon bow clips.',
      stylistNames: ['Ananya'],
    },
    {
      name: 'Junior Spiky Cool Boy Cut',
      category: 'Kids Styling',
      targetGender: ServiceGender.KIDS,
      price: 350,
      durationMinutes: 30,
      description: 'Trendy side-part or textured spiky haircut with non-sticky kids styling gel.',
      stylistNames: ['Trilok'],
    },
  ];

  let createdCount = 0;
  let updatedCount = 0;

  for (const s of servicesData) {
    const categoryId = categoryMap.get(s.category.toUpperCase());

    // Resolve stylists
    const targetStylistIds: string[] = [];
    for (const namePart of s.stylistNames) {
      const stylist = getStylist(namePart);
      if (stylist) targetStylistIds.push(stylist.id);
    }

    const existing = await prisma.service.findFirst({
      where: {
        salonId: salon.id,
        name: { equals: s.name, mode: 'insensitive' },
      },
    });

    let serviceId: string;
    if (existing) {
      const updated = await prisma.service.update({
        where: { id: existing.id },
        data: {
          categoryId,
          category: s.category,
          targetGender: s.targetGender,
          price: s.price,
          durationMinutes: s.durationMinutes,
          description: s.description,
          status: ServiceStatus.ACTIVE,
        },
      });
      serviceId = updated.id;
      updatedCount++;
    } else {
      const created = await prisma.service.create({
        data: {
          salonId: salon.id,
          categoryId,
          category: s.category,
          name: s.name,
          description: s.description,
          price: s.price,
          durationMinutes: s.durationMinutes,
          targetGender: s.targetGender,
          status: ServiceStatus.ACTIVE,
        },
      });
      serviceId = created.id;
      createdCount++;
    }

    // Link Stylists
    await prisma.stylistService.deleteMany({
      where: { salonId: salon.id, serviceId },
    });

    if (targetStylistIds.length > 0) {
      await prisma.stylistService.createMany({
        data: targetStylistIds.map((stylistId) => ({
          salonId: salon.id,
          stylistId,
          serviceId,
        })),
        skipDuplicates: true,
      });
    }

    console.log(`  ✓ Service: "${s.name}" | Cat: ${s.category} | Gender: ${s.targetGender} | Stylists: ${targetStylistIds.length}`);
  }

  // Summary
  const totalServices = await prisma.service.count({ where: { salonId: salon.id } });
  const totalCategories = await prisma.serviceCategory.count({ where: { salonId: salon.id } });

  console.log(`\n🎉 Seed Completed Successfully!`);
  console.log(`   - Newly Created: ${createdCount}`);
  console.log(`   - Updated Existing: ${updatedCount}`);
  console.log(`   - Total Services in Salon: ${totalServices}`);
  console.log(`   - Total Categories in Salon: ${totalCategories}`);
}

main()
  .catch((e) => {
    console.error('❌ Error during service seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
