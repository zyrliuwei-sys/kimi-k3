export const envConfigs: Record<string, string> = {
  // App
  app_url: process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000',
  app_name: process.env.NEXT_PUBLIC_APP_NAME ?? 'ShipAny Next',
  app_description: process.env.NEXT_PUBLIC_APP_DESCRIPTION ?? 'Ship your SaaS faster',
  app_logo: process.env.NEXT_PUBLIC_APP_LOGO ?? '/logo.png',

  // Database
  database_url: process.env.DATABASE_URL ?? '',
  database_auth_token: process.env.DATABASE_AUTH_TOKEN ?? '',
  database_provider: process.env.DATABASE_PROVIDER ?? 'sqlite',
  db_schema: process.env.DB_SCHEMA ?? 'public',
  db_singleton_enabled: process.env.DB_SINGLETON_ENABLED ?? 'false',
  db_max_connections: process.env.DB_MAX_CONNECTIONS ?? '1',

  // Auth
  auth_url: process.env.AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? '',
  auth_secret: process.env.AUTH_SECRET ?? '',

  // Payment - Stripe
  stripe_secret_key: process.env.STRIPE_SECRET_KEY ?? '',
  stripe_publishable_key: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
  stripe_signing_secret: process.env.STRIPE_SIGNING_SECRET ?? '',

  // Payment - PayPal
  paypal_client_id: process.env.PAYPAL_CLIENT_ID ?? '',
  paypal_client_secret: process.env.PAYPAL_CLIENT_SECRET ?? '',
  paypal_webhook_id: process.env.PAYPAL_WEBHOOK_ID ?? '',
  paypal_environment: process.env.PAYPAL_ENVIRONMENT ?? 'sandbox',

  // Email - Resend
  resend_api_key: process.env.RESEND_API_KEY ?? '',
  resend_email_from: process.env.RESEND_EMAIL_FROM ?? '',

  // Storage - S3/R2
  storage_endpoint: process.env.STORAGE_ENDPOINT ?? '',
  storage_region: process.env.STORAGE_REGION ?? 'auto',
  storage_access_key: process.env.STORAGE_ACCESS_KEY ?? '',
  storage_secret_key: process.env.STORAGE_SECRET_KEY ?? '',
  storage_bucket: process.env.STORAGE_BUCKET ?? '',
  storage_public_domain: process.env.STORAGE_PUBLIC_DOMAIN ?? '',

  // AI
  replicate_api_token: process.env.REPLICATE_API_TOKEN ?? '',

  // Locale
  locale: process.env.NEXT_PUBLIC_DEFAULT_LOCALE ?? 'en',
};
