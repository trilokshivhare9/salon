const LIVE_API_BASE = 'https://salon-api-tuwo.onrender.com/api/v1';

async function testAddService() {
  console.log('🧪 Testing Add Service API against live production server...');

  // Step 1: Login
  const loginRes = await fetch(`${LIVE_API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: '7999817743', password: 'Test@1234' }),
  });

  const loginData: any = await loginRes.json();
  const token = loginData.data?.accessToken || loginData.data?.tokens?.accessToken;

  if (!token) {
    throw new Error('Login failed!');
  }

  console.log('✅ Logged in successfully.');

  // Step 2: Create a service payload
  const testPayload = {
    name: 'Test Haircut ' + Date.now().toString().slice(-4),
    price: 150,
    durationMinutes: 30,
    category: 'Haircut & Styling',
    targetGender: 'MALE',
    description: 'Test service created via automated diagnostic test',
  };

  console.log('Step 2: Sending POST /services payload:', testPayload);

  const createRes = await fetch(`${LIVE_API_BASE}/services`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(testPayload),
  });

  const createData: any = await createRes.json();
  console.log('Response Status:', createRes.status);
  console.log('Response Data:', JSON.stringify(createData, null, 2));

  if (createRes.status === 201 || createRes.status === 200) {
    console.log('🎉 Service Creation API Succeeded!');
  } else {
    console.error('❌ Service Creation API Failed!');
  }
}

testAddService().catch((err) => console.error('Error:', err));
