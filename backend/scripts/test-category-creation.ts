const LIVE_API_BASE = 'https://salon-api-tuwo.onrender.com/api/v1';

async function testCategoryCreation() {
  console.log('🧪 Testing Service Category Creation API...');

  // 1. Login
  const loginRes = await fetch(`${LIVE_API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '7999817743', password: 'Test@1234' }),
  });
  const loginData: any = await loginRes.json();
  const token = loginData.data?.accessToken || loginData.data?.tokens?.accessToken;

  // 2. Create Category
  const catName = 'TestCat ' + Date.now().toString().slice(-4);
  console.log(`Step 2: Creating category "${catName}"...`);

  const createRes = await fetch(`${LIVE_API_BASE}/services/categories`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ name: catName, icon: '✂️' }),
  });

  const createData = await createRes.json();
  console.log('Create Status:', createRes.status);
  console.log('Create Response:', JSON.stringify(createData, null, 2));

  // 3. Get Categories
  const getRes = await fetch(`${LIVE_API_BASE}/services/categories`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const getData = await getRes.json();
  console.log('Get Categories Status:', getRes.status);
  console.log('Categories Count:', getData.data?.length);
}

testCategoryCreation().catch(console.error);
