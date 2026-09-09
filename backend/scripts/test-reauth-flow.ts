const LIVE_API_BASE = 'https://salon-api-tuwo.onrender.com/api/v1';

async function postJson(url: string, body: any, token?: string) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

async function getJson(url: string, token: string) {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, data: await res.json() };
}

async function testReAuthFlow() {
  console.log('🧪 Starting Empirical Authentication & Re-Auth Test against Live Backend...\n');

  // Test 1: Mobile Login
  console.log('Step 1: Logging in with Mobile Number "7999817743"...');
  const loginRes = await postJson(`${LIVE_API_BASE}/auth/login`, {
    email: '7999817743',
    password: 'Test@1234',
  });

  if (loginRes.status !== 200 || !loginRes.data.data) {
    throw new Error(`❌ Login failed! Status: ${loginRes.status}`);
  }

  const { accessToken, refreshToken, user } = loginRes.data.data;
  console.log(`✅ Mobile Login Successful!`);
  console.log(`   User ID: ${user.id}`);
  console.log(`   User Name: ${user.name}`);
  console.log(`   User Role: ${user.role}`);
  console.log(`   User Salon: ${user.salon?.name || 'N/A'}`);
  console.log(`   Access Token Received: ${accessToken.slice(0, 25)}...`);
  console.log(`   Refresh Token Received: ${refreshToken.slice(0, 25)}...\n`);

  // Test 2: Authenticated Request with Access Token
  console.log('Step 2: Testing authenticated request to /auth/me...');
  const meRes = await getJson(`${LIVE_API_BASE}/auth/me`, accessToken);

  if (meRes.status !== 200 || meRes.data.data.id !== user.id) {
    throw new Error('❌ Authenticated request failed!');
  }
  console.log(`✅ /auth/me request verified successfully! User ID matches: ${meRes.data.data.id}\n`);

  // Test 3: Session Refresh via Refresh Token
  console.log('Step 3: Refreshing session via /auth/refresh...');
  const refreshRes = await postJson(`${LIVE_API_BASE}/auth/refresh`, {
    refreshToken,
  });

  if (refreshRes.status !== 200 || !refreshRes.data.data.accessToken) {
    throw new Error('❌ Token refresh failed!');
  }
  console.log(`✅ Token Refresh Successful! New Access Token: ${refreshRes.data.data.accessToken.slice(0, 25)}...\n`);

  // Test 4: Re-Authentication with Mobile Number & Password
  console.log('Step 4: Simulating In-Place Re-Authentication with Mobile Identifier...');
  const reAuthRes = await postJson(`${LIVE_API_BASE}/auth/login`, {
    email: '7999817743',
    password: 'Test@1234',
  });

  if (reAuthRes.status !== 200 || !reAuthRes.data.data.accessToken) {
    throw new Error('❌ Re-Authentication failed!');
  }
  console.log(`✅ Re-Authentication Successful! Fresh session token issued.\n`);

  console.log('🎉 ALL EMPIRICAL INTEGRATION TESTS PASSED CLEANLY!');
}

testReAuthFlow().catch((err) => {
  console.error('❌ Test failed with error:', err.message);
  process.exit(1);
});
