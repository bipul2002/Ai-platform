export default () => ({
  port: parseInt(process.env.PORT || '4000', 10),
  database: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/ai_query_platform',
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'default-secret-change-in-production',
    expiration: process.env.JWT_EXPIRATION || '24h',
    refreshExpiration: process.env.JWT_REFRESH_EXPIRATION || '7d',
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || '32-byte-encryption-key-here!!!!',
  },
  aiRuntime: {
    url: process.env.AI_RUNTIME_URL || 'http://localhost:8000',
  },
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },
  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },
  frontendUrl: process.env.FRONTEND_URL,
  email: {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
    rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED === 'true' ? false : true,
  }
});
