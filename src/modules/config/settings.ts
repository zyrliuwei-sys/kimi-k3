/**
 * Settings definitions — tabs, groups, and fields.
 *
 * This drives the admin settings UI. Add new settings here
 * and they'll automatically appear in the admin panel.
 */

export interface Setting {
  name: string;
  title: string;
  type: 'text' | 'password' | 'textarea' | 'number' | 'switch' | 'select';
  placeholder?: string;
  options?: { label: string; value: string }[];
  tip?: string;
  group: string;
  tab: string;
  defaultValue?: string;
}

export interface SettingGroup {
  name: string;
  title: string;
  description?: string;
  tab: string;
}

export interface SettingTab {
  name: string;
  title: string;
}

export function getSettingTabs(): SettingTab[] {
  return [
    { name: 'general', title: 'General' },
    { name: 'auth', title: 'Auth' },
    { name: 'payment', title: 'Payment' },
    { name: 'email', title: 'Email' },
    { name: 'storage', title: 'Storage' },
    { name: 'ai', title: 'AI' },
  ];
}

export function getSettingGroups(): SettingGroup[] {
  return [
    // General
    { name: 'appinfo', title: 'App Info', description: 'Basic application settings', tab: 'general' },
    { name: 'user_role', title: 'User Roles', description: 'Default role for new users', tab: 'general' },
    { name: 'credit', title: 'Credits', description: 'Initial credits for new users', tab: 'general' },

    // Auth
    { name: 'email_auth', title: 'Email Auth', description: 'Email/password authentication', tab: 'auth' },
    { name: 'google_auth', title: 'Google Auth', description: 'Google OAuth login', tab: 'auth' },
    { name: 'github_auth', title: 'GitHub Auth', description: 'GitHub OAuth login', tab: 'auth' },

    // Payment
    { name: 'basic_payment', title: 'Basic', description: 'Payment general settings', tab: 'payment' },
    { name: 'stripe', title: 'Stripe', description: 'Stripe payment gateway', tab: 'payment' },
    { name: 'creem', title: 'Creem', description: 'Creem payment gateway', tab: 'payment' },
    { name: 'paypal', title: 'PayPal', description: 'PayPal payment gateway', tab: 'payment' },
    { name: 'alipay', title: 'Alipay', description: 'Alipay payment gateway (native)', tab: 'payment' },
    { name: 'wechat', title: 'WeChat Pay', description: 'WeChat Pay gateway (native)', tab: 'payment' },

    // Email
    { name: 'resend', title: 'Resend', description: 'Resend email service', tab: 'email' },

    // Storage
    { name: 'r2', title: 'Cloudflare R2 / S3', description: 'Object storage settings', tab: 'storage' },

    // AI
    { name: 'replicate', title: 'Replicate', description: 'Replicate AI API', tab: 'ai' },
    { name: 'gemini', title: 'Gemini', description: 'Google Gemini API', tab: 'ai' },
    { name: 'fal', title: 'Fal', description: 'Fal AI API', tab: 'ai' },
  ];
}

export function getSettings(): Setting[] {
  return [
    // ─── General / App Info ──────────────────────────────────────────
    { name: 'app_name', title: 'App Name', type: 'text', placeholder: 'My App', group: 'appinfo', tab: 'general' },
    { name: 'app_description', title: 'App Description', type: 'textarea', placeholder: 'Ship your SaaS faster', group: 'appinfo', tab: 'general' },
    { name: 'app_url', title: 'App URL', type: 'text', placeholder: 'https://example.com', group: 'appinfo', tab: 'general' },

    // ─── General / User Roles ────────────────────────────────────────
    { name: 'initial_role_enabled', title: 'Auto-assign role for new users', type: 'switch', group: 'user_role', tab: 'general' },
    { name: 'initial_role_name', title: 'Default role name', type: 'text', placeholder: 'viewer', group: 'user_role', tab: 'general' },

    // ─── General / Credits ───────────────────────────────────────────
    { name: 'initial_credits_enabled', title: 'Grant credits on signup', type: 'switch', group: 'credit', tab: 'general' },
    { name: 'initial_credits_amount', title: 'Credits amount', type: 'number', placeholder: '100', group: 'credit', tab: 'general' },
    { name: 'initial_credits_valid_days', title: 'Valid days', type: 'number', placeholder: '365', group: 'credit', tab: 'general' },
    { name: 'initial_credits_description', title: 'Description', type: 'text', placeholder: 'Welcome bonus', group: 'credit', tab: 'general' },

    // ─── Auth / Email ────────────────────────────────────────────────
    { name: 'email_auth_enabled', title: 'Enable email auth', type: 'switch', group: 'email_auth', tab: 'auth', defaultValue: 'true' },
    { name: 'email_verification_enabled', title: 'Require email verification on sign up', type: 'switch', group: 'email_auth', tab: 'auth', defaultValue: 'false' },
    { name: 'invite_code_required', title: 'Require invite code on sign up', type: 'switch', group: 'email_auth', tab: 'auth', defaultValue: 'false' },

    // ─── Auth / Google ───────────────────────────────────────────────
    { name: 'google_auth_enabled', title: 'Enable Google auth', type: 'switch', group: 'google_auth', tab: 'auth' },
    { name: 'google_one_tap_enabled', title: 'Enable Google One Tap', type: 'switch', group: 'google_auth', tab: 'auth', tip: 'Show the Google One Tap prompt to signed-out visitors. Requires Client ID.' },
    { name: 'google_client_id', title: 'Client ID', type: 'text', placeholder: 'xxx.apps.googleusercontent.com', group: 'google_auth', tab: 'auth' },
    { name: 'google_client_secret', title: 'Client Secret', type: 'password', placeholder: 'GOCSPX-xxx', group: 'google_auth', tab: 'auth' },

    // ─── Auth / GitHub ───────────────────────────────────────────────
    { name: 'github_auth_enabled', title: 'Enable GitHub auth', type: 'switch', group: 'github_auth', tab: 'auth' },
    { name: 'github_client_id', title: 'Client ID', type: 'text', placeholder: 'Ov23xxx', group: 'github_auth', tab: 'auth' },
    { name: 'github_client_secret', title: 'Client Secret', type: 'password', placeholder: 'xxx', group: 'github_auth', tab: 'auth' },

    // ─── Payment / Basic ─────────────────────────────────────────────
    { name: 'select_payment_enabled', title: 'Show payment method selector', type: 'switch', group: 'basic_payment', tab: 'payment' },
    {
      name: 'default_payment_provider', title: 'Default provider', type: 'select',
      options: [
        { label: 'Stripe', value: 'stripe' },
        { label: 'Creem', value: 'creem' },
        { label: 'PayPal', value: 'paypal' },
        { label: 'Alipay', value: 'alipay' },
        { label: 'WeChat Pay', value: 'wechat' },
      ],
      group: 'basic_payment', tab: 'payment',
    },

    // ─── Payment / Stripe ────────────────────────────────────────────
    { name: 'stripe_enabled', title: 'Enable Stripe', type: 'switch', group: 'stripe', tab: 'payment' },
    { name: 'stripe_publishable_key', title: 'Publishable Key', type: 'text', placeholder: 'pk_xxx', group: 'stripe', tab: 'payment' },
    { name: 'stripe_api_key', title: 'Secret Key', type: 'password', placeholder: 'sk_xxx', group: 'stripe', tab: 'payment' },
    { name: 'stripe_webhook_secret', title: 'Webhook Secret', type: 'password', placeholder: 'whsec_xxx', group: 'stripe', tab: 'payment' },

    // ─── Payment / Creem ─────────────────────────────────────────────
    { name: 'creem_enabled', title: 'Enable Creem', type: 'switch', group: 'creem', tab: 'payment' },
    {
      name: 'creem_environment', title: 'Environment', type: 'select',
      options: [
        { label: 'Sandbox', value: 'sandbox' },
        { label: 'Production', value: 'production' },
      ],
      group: 'creem', tab: 'payment', defaultValue: 'sandbox',
    },
    { name: 'creem_api_key', title: 'API Key', type: 'password', placeholder: 'creem_xxx', group: 'creem', tab: 'payment' },
    { name: 'creem_signing_secret', title: 'Signing Secret', type: 'password', placeholder: 'whsec_xxx', group: 'creem', tab: 'payment' },
    { name: 'creem_test_amount', title: 'Test amount (cents)', type: 'number', placeholder: '留空使用实际金额，填 1 则支付 $0.01', group: 'creem', tab: 'payment' },

    // ─── Payment / PayPal ────────────────────────────────────────────
    { name: 'paypal_enabled', title: 'Enable PayPal', type: 'switch', group: 'paypal', tab: 'payment' },
    { name: 'paypal_client_id', title: 'Client ID', type: 'text', placeholder: 'xxx', group: 'paypal', tab: 'payment' },
    { name: 'paypal_client_secret', title: 'Client Secret', type: 'password', placeholder: 'xxx', group: 'paypal', tab: 'payment' },
    { name: 'paypal_webhook_id', title: 'Webhook ID', type: 'text', placeholder: 'xxx', group: 'paypal', tab: 'payment' },
    {
      name: 'paypal_environment', title: 'Environment', type: 'select',
      options: [
        { label: 'Sandbox', value: 'sandbox' },
        { label: 'Live', value: 'live' },
      ],
      group: 'paypal', tab: 'payment',
    },
    { name: 'paypal_test_amount', title: 'Test amount (cents)', type: 'number', placeholder: '留空使用实际金额，填 1 则支付 $0.01', group: 'paypal', tab: 'payment' },

    // ─── Payment / Alipay ─────────────────────────────────────────────
    { name: 'alipay_enabled', title: 'Enable Alipay', type: 'switch', group: 'alipay', tab: 'payment' },
    { name: 'alipay_app_id', title: 'App ID', type: 'text', placeholder: '2021xxx', group: 'alipay', tab: 'payment' },
    { name: 'alipay_private_key', title: 'Private Key (RSA2)', type: 'textarea', placeholder: 'MIIEvQIBADANBgkq...', group: 'alipay', tab: 'payment' },
    { name: 'alipay_public_key', title: 'Alipay Public Key', type: 'textarea', placeholder: 'MIIBIjANBgkq...', group: 'alipay', tab: 'payment' },
    { name: 'alipay_notify_url', title: 'Notify URL (Webhook)', type: 'text', placeholder: 'https://hersoul.cn/api/payment/notify/alipay', group: 'alipay', tab: 'payment' },
    { name: 'alipay_test_amount', title: 'Test amount (分)', type: 'number', placeholder: '留空使用实际金额，填 1 则支付 ¥0.01', group: 'alipay', tab: 'payment' },

    // ─── Payment / WeChat Pay ───────────────────────────────────────
    { name: 'wechat_enabled', title: 'Enable WeChat Pay', type: 'switch', group: 'wechat', tab: 'payment' },
    { name: 'wechat_app_id', title: 'AppID', type: 'text', placeholder: 'wx1234567890', group: 'wechat', tab: 'payment' },
    { name: 'wechat_mch_id', title: 'Merchant ID (商户号)', type: 'text', placeholder: '1900000001', group: 'wechat', tab: 'payment' },
    { name: 'wechat_api_v3_key', title: 'APIv3 Key (32位密钥)', type: 'password', placeholder: '32 chars', group: 'wechat', tab: 'payment' },
    { name: 'wechat_private_key', title: 'Merchant Private Key (PEM)', type: 'textarea', placeholder: 'MIIEvgIBADANBgkq...', group: 'wechat', tab: 'payment' },
    { name: 'wechat_serial_no', title: 'Certificate Serial No', type: 'text', placeholder: 'xxx', group: 'wechat', tab: 'payment' },
    { name: 'wechat_notify_url', title: 'Notify URL (Webhook)', type: 'text', placeholder: 'https://hersoul.cn/api/payment/notify/wechat', group: 'wechat', tab: 'payment' },
    { name: 'wechat_test_amount', title: 'Test amount (分)', type: 'number', placeholder: '留空使用实际金额，填 1 则支付 ¥0.01', group: 'wechat', tab: 'payment' },

    // ─── Email / Resend ──────────────────────────────────────────────
    { name: 'resend_api_key', title: 'API Key', type: 'password', placeholder: 're_xxx', group: 'resend', tab: 'email' },
    { name: 'resend_email_from', title: 'From Address', type: 'text', placeholder: 'hello@example.com', group: 'resend', tab: 'email' },

    // ─── Storage / R2 ────────────────────────────────────────────────
    { name: 'storage_endpoint', title: 'Endpoint', type: 'text', placeholder: 'https://xxx.r2.cloudflarestorage.com', group: 'r2', tab: 'storage' },
    { name: 'storage_region', title: 'Region', type: 'text', placeholder: 'auto', group: 'r2', tab: 'storage' },
    { name: 'storage_access_key', title: 'Access Key', type: 'password', placeholder: 'xxx', group: 'r2', tab: 'storage' },
    { name: 'storage_secret_key', title: 'Secret Key', type: 'password', placeholder: 'xxx', group: 'r2', tab: 'storage' },
    { name: 'storage_bucket', title: 'Bucket', type: 'text', placeholder: 'my-bucket', group: 'r2', tab: 'storage' },
    { name: 'storage_public_domain', title: 'Public Domain', type: 'text', placeholder: 'https://cdn.example.com', group: 'r2', tab: 'storage' },

    // ─── AI / Replicate ──────────────────────────────────────────────
    { name: 'replicate_api_token', title: 'API Token', type: 'password', placeholder: 'r8_xxx', group: 'replicate', tab: 'ai' },

    // ─── AI / Gemini ─────────────────────────────────────────────────
    { name: 'gemini_api_key', title: 'API Key', type: 'password', placeholder: 'xxx', group: 'gemini', tab: 'ai' },

    // ─── AI / Fal ────────────────────────────────────────────────────
    { name: 'fal_api_key', title: 'API Key', type: 'password', placeholder: 'xxx', group: 'fal', tab: 'ai' },
  ];
}
