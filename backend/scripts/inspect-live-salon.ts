import fetch from 'node-fetch';

const LIVE_API_BASE = 'https://salon-api-tuwo.onrender.com/api/v1';

async function inspectLiveSalon() {
  console.log('================================================================');
  console.log('  🔍 LIVE SALON DIAGNOSTIC AUDIT (Mobile: 7999817743)          ');
  console.log('================================================================\n');

  const credentials = {
    email: '7999817743',
    password: 'Test@1234',
  };

  try {
    // 1. Test Login to Live API
    console.log(`[API Call] POST ${LIVE_API_BASE}/auth/login...`);
    const loginRes = await fetch(`${LIVE_API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials),
    });

    const loginData: any = await loginRes.json();
    console.log(`HTTP Status: ${loginRes.status}`);
    console.log(`Login Response:\n`, JSON.stringify(loginData, null, 2));

    if (!loginRes.ok || !loginData.data || !loginData.data.accessToken) {
      console.error('\n❌ LIVE LOGIN FAILED! Check credentials or server errors.');
      return;
    }

    const token = loginData.data.accessToken;
    const authHeaders = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };

    // 2. Fetch Salon Profile
    console.log(`\n[API Call] GET ${LIVE_API_BASE}/salons/profile...`);
    const profileRes = await fetch(`${LIVE_API_BASE}/salons/profile`, { headers: authHeaders });
    const profileData: any = await profileRes.json();
    console.log(`Salon Profile:\n`, JSON.stringify(profileData, null, 2));

    // 3. Fetch Salon WhatsApp Configuration / Account Status
    console.log(`\n[API Call] GET ${LIVE_API_BASE}/whatsapp/status...`);
    const waRes = await fetch(`${LIVE_API_BASE}/whatsapp/status`, { headers: authHeaders });
    const waData: any = await waRes.json();
    console.log(`WhatsApp Status:\n`, JSON.stringify(waData, null, 2));

    // 4. Fetch Salon Service Categories & Services
    console.log(`\n[API Call] GET ${LIVE_API_BASE}/services/categories...`);
    const catRes = await fetch(`${LIVE_API_BASE}/services/categories`, { headers: authHeaders });
    const catData: any = await catRes.json();
    console.log(`Service Categories Count: ${Array.isArray(catData) ? catData.length : 0}`);

    console.log(`\n[API Call] GET ${LIVE_API_BASE}/services...`);
    const svcRes = await fetch(`${LIVE_API_BASE}/services`, { headers: authHeaders });
    const svcData: any = await svcRes.json();
    console.log(`Services Count: ${Array.isArray(svcData) ? svcData.length : 0}`);

    // 5. Fetch Recent WhatsApp Logs for this Salon
    console.log(`\n[API Call] GET ${LIVE_API_BASE}/whatsapp/logs...`);
    const logsRes = await fetch(`${LIVE_API_BASE}/whatsapp/logs`, { headers: authHeaders });
    const logsData: any = await logsRes.json();
    console.log(`Recent WhatsApp Logs:\n`, JSON.stringify(logsData, null, 2));

  } catch (err) {
    console.error('❌ Error executing live diagnostic:', err);
  }
}

inspectLiveSalon();
