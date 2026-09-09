const LOCAL_API_BASE = 'http://localhost:3000/api/v1';

async function testCustomCategoryFlow() {
  console.log('🧪 Testing Custom Category Auto-Creation & Linking on Local Backend (http://localhost:3000/api/v1)...\n');

  // Step 1: Login
  const loginRes = await fetch(`${LOCAL_API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '7999817743', password: 'Test@1234' }),
  });
  const loginData: any = await loginRes.json();
  const token = loginData.data?.accessToken || loginData.data?.tokens?.accessToken;

  if (!token) throw new Error('Login failed!');

  // Step 2: Create a service with a custom category name (e.g. "Bridal Special 99")
  const customCatName = 'Bridal Special ' + Date.now().toString().slice(-4);
  console.log(`Step 2: Creating new service with custom category text "${customCatName}"...`);

  const createServiceRes = await fetch(`${LOCAL_API_BASE}/services`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      name: 'Bridal Package Test',
      price: 2500,
      durationMinutes: 60,
      category: customCatName,
      targetGender: 'FEMALE',
      description: 'Custom category auto-creation test',
    }),
  });

  const serviceData: any = await createServiceRes.json();
  console.log('Service Creation Status:', createServiceRes.status);
  console.log('Service Data:', JSON.stringify(serviceData.data, null, 2));

  if (!serviceData.data?.categoryId) {
    throw new Error('❌ FAILED: Service categoryId is null! Auto-creation of ServiceCategory failed.');
  }

  console.log(`\n✅ SUCCESS: Custom Category "${customCatName}" auto-created in DB with categoryId: ${serviceData.data.categoryId}`);

  // Step 3: Fetch categories list and verify custom category is listed
  const categoriesRes = await fetch(`${LOCAL_API_BASE}/services/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const categoriesData: any = await categoriesRes.json();
  const matched = (categoriesData.data || []).find((c: any) => c.name === customCatName);

  if (!matched) {
    throw new Error(`❌ FAILED: Custom category "${customCatName}" not found in /services/categories list!`);
  }

  console.log(`✅ SUCCESS: Verified category "${matched.name}" (ID: ${matched.id}) is listed in categories API!\n`);
  console.log('🎉 ALL CUSTOM CATEGORY TESTS PASSED CLEANLY!');
}

testCustomCategoryFlow().catch(console.error);
