import * as readline from 'readline';

/**
 * PRODUCTION DATABASE SAFETY GUARD
 * 
 * Prevents accidental execution of destructive commands (e.g. migration, studio)
 * against the live Production database.
 * 
 * Production detection is based on:
 * 1. NODE_ENV === 'production'
 * 2. APP_ENV === 'production'
 * 3. IS_PRODUCTION_DB === 'true'
 * 4. DATABASE_URL hostname matching remote production host (e.g. render.com)
 */
async function guardProductionExecution() {
  const nodeEnv = (process.env.NODE_ENV || '').toLowerCase();
  const appEnv = (process.env.APP_ENV || '').toLowerCase();
  const isProdFlag = process.env.IS_PRODUCTION_DB === 'true';
  const dbUrl = process.env.DATABASE_URL || '';
  const isRemoteDB = dbUrl.includes('render.com') || dbUrl.includes('singapore-postgres');

  const isProduction = nodeEnv === 'production' || appEnv === 'production' || isProdFlag || isRemoteDB;

  if (!isProduction) {
    console.log(`[EnvironmentGuard] Running in DEVELOPMENT environment (${dbUrl.split('@')[1]?.split('/')[0] || 'localhost'}). Proceeding...\n`);
    return;
  }

  console.log('\n================================================================');
  console.log('⚠️   CRITICAL WARNING: PRODUCTION DATABASE DETECTED');
  console.log('================================================================');
  console.log(`Node Environment: ${nodeEnv || 'not set'}`);
  console.log(`App Environment:  ${appEnv || 'not set'}`);
  console.log('Target Host:      LIVE PRODUCTION DATABASE');
  console.log('----------------------------------------------------------------');
  console.log('You are attempting to run a command against the LIVE Production database.');
  console.log('This database contains REAL salon operations and customer data.\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  return new Promise<void>((resolve) => {
    rl.question('Type "YES_I_UNDERSTAND_THIS_IS_PRODUCTION" to continue: ', (answer) => {
      rl.close();
      if (answer.trim() === 'YES_I_UNDERSTAND_THIS_IS_PRODUCTION') {
        console.log('✅ Production access confirmed. Proceeding with command...\n');
        resolve();
      } else {
        console.error('❌ Production access cancelled. Command aborted immediately.\n');
        process.exit(1);
      }
    });
  });
}

guardProductionExecution();
