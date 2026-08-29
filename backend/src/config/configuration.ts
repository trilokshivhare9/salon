export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  database: {
    url: process.env.DATABASE_URL || 'postgresql://trilokshivhare@localhost:5432/salon_saas?schema=public',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'salon-saas-super-secret-jwt-key-change-in-production-min32chars',
    expiresIn: process.env.JWT_EXPIRES_IN || '1d',
  },
  cors: {
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:8080,http://localhost:5173').split(','),
  },
  whatsapp: {
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'salon_webhook_verify_token_mvp',
  },
});
