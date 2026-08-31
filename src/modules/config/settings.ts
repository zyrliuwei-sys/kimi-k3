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
    { name: 'analytics', title: 'Analytics' },
    { name: 'customer_service', title: 'Customer Service' },
    { name: 'custom', title: 'Custom' },
  ];
}

export function getSettingGroups(): SettingGroup[] {
  return [
    // General
    {
      name: 'appinfo',
      title: 'App Info',
      description: 'Basic application settings',
      tab: 'general',
    },
    {
      name: 'user_role',
      title: 'User Roles',
      description: 'Default role for new users',
      tab: 'general',
    },
    {
      name: 'credit',
      title: 'Credits',
      description: 'Initial credits for new users',
      tab: 'general',
    },

    // Auth
    {
      name: 'email_auth',
      title: 'Email Auth',
      description: 'Email/password authentication',
      tab: 'auth',
    },
    {
      name: 'google_auth',
      title: 'Google Auth',
      description: 'Google OAuth login',
      tab: 'auth',
    },
    {
      name: 'github_auth',
      title: 'GitHub Auth',
      description: 'GitHub OAuth login',
      tab: 'auth',
    },
    {
      name: 'bot_protection',
      title: 'Bot Protection',
      description:
        'Cloudflare Turnstile CAPTCHA on sign-up / sign-in / forgot-password',
      tab: 'auth',
    },

    // Payment
    {
      name: 'basic_payment',
      title: 'Basic',
      description: 'Payment general settings',
      tab: 'payment',
    },
    {
      name: 'stripe',
      title: 'Stripe',
      description: 'Stripe payment gateway',
      tab: 'payment',
    },
    {
      name: 'creem',
      title: 'Creem',
      description: 'Creem payment gateway',
      tab: 'payment',
    },
    {
      name: 'waffo',
      title: 'Waffo Pancake',
      description: 'Waffo Pancake hosted checkout gateway',
      tab: 'payment',
    },
    {
      name: 'paypal',
      title: 'PayPal',
      description: 'PayPal payment gateway',
      tab: 'payment',
    },
    {
      name: 'alipay',
      title: 'Alipay',
      description: 'Alipay payment gateway (native)',
      tab: 'payment',
    },
    {
      name: 'wechat',
      title: 'WeChat Pay',
      description: 'WeChat Pay gateway (native)',
      tab: 'payment',
    },

    // Email
    {
      name: 'email_general',
      title: 'General',
      description: 'Email provider selection',
      tab: 'email',
    },
    {
      name: 'resend',
      title: 'Resend',
      description: 'Resend email service',
      tab: 'email',
    },
    {
      name: 'cloudflare_email',
      title: 'Cloudflare Email',
      description: 'Cloudflare Email Service',
      tab: 'email',
    },

    // Storage
    {
      name: 'r2',
      title: 'Cloudflare R2 / S3',
      description: 'Object storage settings',
      tab: 'storage',
    },

    // AI
    {
      name: 'openai',
      title: 'OpenAI',
      description: 'OpenAI (or compatible) API',
      tab: 'ai',
    },
    {
      name: 'evolink',
      title: 'EvoLink',
      description: 'EvoLink — Kimi K3 (and other models), OpenAI-compatible',
      tab: 'ai',
    },
    {
      name: 'seedance_video',
      title: 'Seedance 2.0 Video',
      description: 'EvoLink Seedance 2.0 text-to-video generation and credits',
      tab: 'ai',
    },
    {
      name: 'anthropic',
      title: 'Anthropic',
      description: 'Anthropic Claude API',
      tab: 'ai',
    },
    {
      name: 'replicate',
      title: 'Replicate',
      description: 'Replicate AI API',
      tab: 'ai',
    },
    { name: 'fal', title: 'Fal', description: 'Fal AI API', tab: 'ai' },
    {
      name: 'screenshot',
      title: 'Screenshot',
      description:
        'URL → screenshot service (remote API) for the URL → clone playground task',
      tab: 'ai',
    },
    {
      name: 'audit',
      title: 'Website Audit',
      description:
        'AI Website Auditor — paste a URL, get a 7-dimension audit + Cursor-ready fixes',
      tab: 'ai',
    },
    {
      name: 'mcp',
      title: 'MCP Servers',
      description:
        'Model Context Protocol servers — extra tools the AI chat can call (remote/HTTP only)',
      tab: 'ai',
    },

    // Analytics
    {
      name: 'google_analytics',
      title: 'Google Analytics',
      description: 'Inject gtag.js with the configured Measurement ID',
      tab: 'analytics',
    },
    {
      name: 'plausible',
      title: 'Plausible',
      description: 'Inject plausible.js for self-hosted or cloud Plausible',
      tab: 'analytics',
    },

    // Customer Service
    {
      name: 'crisp',
      title: 'Crisp',
      description: 'Crisp live chat widget',
      tab: 'customer_service',
    },
    {
      name: 'tawk',
      title: 'Tawk.to',
      description: 'Tawk.to live chat widget',
      tab: 'customer_service',
    },
  ];
}

export function getSettings(): Setting[] {
  return [
    // ─── General / App Info ──────────────────────────────────────────
    {
      name: 'app_name',
      title: 'App Name',
      type: 'text',
      placeholder: 'kimik3',
      group: 'appinfo',
      tab: 'general',
    },
    {
      name: 'app_description',
      title: 'App Description',
      type: 'textarea',
      placeholder:
        'kimik3 — the all-in-one AI workspace for chat, research, and content.',
      group: 'appinfo',
      tab: 'general',
    },
    {
      name: 'app_url',
      title: 'App URL',
      type: 'text',
      placeholder: 'https://example.com',
      group: 'appinfo',
      tab: 'general',
    },

    // ─── General / User Roles ────────────────────────────────────────
    {
      name: 'initial_role_enabled',
      title: 'Auto-assign role for new users',
      type: 'switch',
      group: 'user_role',
      tab: 'general',
    },
    {
      name: 'initial_role_name',
      title: 'Default role name',
      type: 'text',
      placeholder: 'viewer',
      group: 'user_role',
      tab: 'general',
    },

    // ─── General / Credits ───────────────────────────────────────────
    // Defaults are tuned for an overseas B2C AI product where Kimi K3 is
    // the model. 1 credit ≈ $0.015 of API cost, so 5 credits ≈ $0.07 CAC
    // — far under industry freemium norms ($3-15). At 5 cr per PPT deck
    // that's exactly one deck, or a handful of chat turns: enough to see
    // the product work, tight enough to nudge toward the paywall.
    //
    // Image generation is priced above the bonus on purpose (~10 cr for a
    // 1024×1024 render), so the first two images are handed out as a separate
    // one-shot trial instead — see `image_first_free` on the AI tab. Net
    // first-run allowance: 5 credits + 1 image; the second image is paid.
    //
    // Granted at sign-up (src/routes/api/auth/$.ts) — the grant does NOT
    // wait for email verification. Abuse is handled by the QQ/Foxmail
    // domain block + 3-per-IP cap + Turnstile, not by withholding the
    // bonus.

    {
      name: 'initial_credits_enabled',
      title: 'Grant credits on signup',
      type: 'switch',
      group: 'credit',
      tab: 'general',
      defaultValue: 'true',
    },
    {
      name: 'initial_credits_amount',
      title: 'Credits amount',
      type: 'number',
      placeholder: '100',
      defaultValue: '5',
      group: 'credit',
      tab: 'general',
    },
    {
      name: 'initial_credits_valid_days',
      title: 'Valid days',
      type: 'number',
      placeholder: '365',
      defaultValue: '30',
      group: 'credit',
      tab: 'general',
    },
    {
      name: 'initial_credits_description',
      title: 'Description',
      type: 'text',
      placeholder: 'Welcome bonus',
      group: 'credit',
      tab: 'general',
    },
    {
      // Per-deck credit cost — applied at generateDeck() in
      // src/modules/ppt/service.ts. Lets the admin tune the PPT-to-credit
      // ratio without a redeploy. Defaults to 5 (≈ 2 decks from the
      // 10-credit signup bonus).
      name: 'ppt_credit_cost',
      title: 'Credits per PPT deck',
      type: 'number',
      placeholder: '5',
      defaultValue: '5',
      group: 'credit',
      tab: 'general',
    },
    {
      // Per-token chat billing — input and output billed SEPARATELY at
      // 7× the EvoLink wholesale cost (input 0.204 cr/1k, output 1.02 cr/1k;
      // output is ~5× pricier, so it gets its own rate). Applied at
      // /api/playground/chat, /api/chat/$id, and doc-library `ask`.
      //
      // Flow: pre-flight reserves on ESTIMATED input tokens (so a drained
      // balance is rejected before we call the model — admin never pays for
      // a request the user can't cover); post-flight settles to ACTUAL
      // usage (usage.prompt_tokens × inputRate + usage.completion_tokens ×
      // outputRate), surcharging the difference for long outputs and
      // refunding for short ones. Longer chats / bigger files ⇒ more credits.
      name: 'chat_credit_per_1k_input_tokens',
      title: 'Chat credits per 1k INPUT tokens',
      type: 'number',
      placeholder: '1.428',
      defaultValue: '1.428',
      min: 0,
      group: 'credit',
      tab: 'general',
      tip: "Per 1k input/prompt tokens (the user's message + history + uploaded file text). 1.428 ≈ 7× wholesale cost.",
    },
    {
      name: 'chat_credit_per_1k_output_tokens',
      title: 'Chat credits per 1k OUTPUT tokens',
      type: 'number',
      placeholder: '7.14',
      defaultValue: '7.14',
      min: 0,
      group: 'credit',
      tab: 'general',
      tip: 'Per 1k tokens the model generates (the reply). Output costs ~5× input, so default 7.14 ≈ 7× wholesale. Long replies cost proportionally more.',
    },
    {
      name: 'chat_credit_min_per_call',
      title: 'Chat credits min per call',
      type: 'number',
      placeholder: '1',
      defaultValue: '1',
      min: 0,
      group: 'credit',
      tab: 'general',
      tip: 'Minimum credits charged per chat/doc query, even when the per-token math rounds below this.',
    },

    // ─── Auth / Email ────────────────────────────────────────────────
    {
      name: 'email_auth_enabled',
      title: 'Enable email auth',
      type: 'switch',
      group: 'email_auth',
      tab: 'auth',
      defaultValue: 'true',
    },
    {
      name: 'email_verification_enabled',
      title: 'Require email verification on sign up',
      type: 'switch',
      group: 'email_auth',
      tab: 'auth',
      defaultValue: 'false',
    },
    {
      name: 'invite_code_required',
      title: 'Require invite code on sign up',
      type: 'switch',
      group: 'email_auth',
      tab: 'auth',
      defaultValue: 'false',
    },

    // ─── Auth / Google ───────────────────────────────────────────────
    {
      name: 'google_auth_enabled',
      title: 'Enable Google auth',
      type: 'switch',
      group: 'google_auth',
      tab: 'auth',
    },
    {
      name: 'google_one_tap_enabled',
      title: 'Enable Google One Tap',
      type: 'switch',
      group: 'google_auth',
      tab: 'auth',
      tip: 'Show the Google One Tap prompt to signed-out visitors. Requires Client ID.',
    },
    {
      name: 'google_client_id',
      title: 'Client ID',
      type: 'text',
      placeholder: 'xxx.apps.googleusercontent.com',
      group: 'google_auth',
      tab: 'auth',
    },
    {
      name: 'google_client_secret',
      title: 'Client Secret',
      type: 'password',
      placeholder: 'GOCSPX-xxx',
      group: 'google_auth',
      tab: 'auth',
    },

    // ─── Auth / GitHub ───────────────────────────────────────────────
    {
      name: 'github_auth_enabled',
      title: 'Enable GitHub auth',
      type: 'switch',
      group: 'github_auth',
      tab: 'auth',
    },
    {
      name: 'github_client_id',
      title: 'Client ID',
      type: 'text',
      placeholder: 'Ov23xxx',
      group: 'github_auth',
      tab: 'auth',
    },
    {
      name: 'github_client_secret',
      title: 'Client Secret',
      type: 'password',
      placeholder: 'xxx',
      group: 'github_auth',
      tab: 'auth',
    },

    // ─── Auth / Bot Protection (Cloudflare Turnstile) ────────────────
    // Opt-in: defaults to off so existing deploys without Turnstile keys
    // aren't broken. Both site key (public) and secret (server-only) must
    // be configured before enabling. The API rejects saving an incomplete
    // enabled configuration and auth requests fail closed as a backstop.
    {
      name: 'turnstile_enabled',
      title: 'Enable Turnstile',
      type: 'switch',
      group: 'bot_protection',
      tab: 'auth',
      defaultValue: 'false',
      tip: 'Off by default. Once on, sign-up / sign-in / forgot-password must pass Turnstile verification.',
    },
    {
      name: 'turnstile_sitekey',
      title: 'Site Key',
      type: 'text',
      placeholder: '0x4AAAAAAA...',
      group: 'bot_protection',
      tab: 'auth',
      tip: 'Public site key from Cloudflare Dashboard → Turnstile → your site.',
    },
    {
      name: 'turnstile_secret',
      title: 'Secret Key',
      type: 'password',
      placeholder: '0x4AAAAAAA...',
      group: 'bot_protection',
      tab: 'auth',
      tip: 'Server-only secret key. Encrypted at rest when CONFIG_ENCRYPTION_KEY is set.',
    },

    // ─── Payment / Basic ─────────────────────────────────────────────
    {
      name: 'select_payment_enabled',
      title: 'Show payment method selector',
      type: 'switch',
      group: 'basic_payment',
      tab: 'payment',
    },
    {
      name: 'default_payment_provider',
      title: 'Default provider',
      type: 'select',
      options: [
        { label: 'Stripe', value: 'stripe' },
        { label: 'Creem', value: 'creem' },
        { label: 'Waffo Pancake', value: 'waffo' },
        { label: 'PayPal', value: 'paypal' },
        { label: 'Alipay', value: 'alipay' },
        { label: 'WeChat Pay', value: 'wechat' },
      ],
      group: 'basic_payment',
      tab: 'payment',
    },

    // ─── Payment / Stripe ────────────────────────────────────────────
    {
      name: 'stripe_enabled',
      title: 'Enable Stripe',
      type: 'switch',
      group: 'stripe',
      tab: 'payment',
    },
    {
      name: 'stripe_publishable_key',
      title: 'Publishable Key',
      type: 'text',
      placeholder: 'pk_xxx',
      group: 'stripe',
      tab: 'payment',
    },
    {
      name: 'stripe_secret_key',
      title: 'Secret Key',
      type: 'password',
      placeholder: 'sk_xxx',
      group: 'stripe',
      tab: 'payment',
    },
    {
      name: 'stripe_signing_secret',
      title: 'Webhook Signing Secret',
      type: 'password',
      placeholder: 'whsec_xxx',
      group: 'stripe',
      tab: 'payment',
    },

    // ─── Payment / Creem ─────────────────────────────────────────────
    {
      name: 'creem_enabled',
      title: 'Enable Creem',
      type: 'switch',
      group: 'creem',
      tab: 'payment',
    },
    {
      name: 'creem_environment',
      title: 'Environment',
      type: 'select',
      options: [
        { label: 'Sandbox', value: 'sandbox' },
        { label: 'Production', value: 'production' },
      ],
      group: 'creem',
      tab: 'payment',
      defaultValue: 'sandbox',
    },
    {
      name: 'creem_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 'creem_xxx',
      group: 'creem',
      tab: 'payment',
    },
    {
      name: 'creem_signing_secret',
      title: 'Signing Secret',
      type: 'password',
      placeholder: 'whsec_xxx',
      group: 'creem',
      tab: 'payment',
    },
    {
      name: 'creem_product_ids_mapping',
      title: 'Product IDs Mapping',
      type: 'textarea',
      placeholder:
        '{"credits_180": "prod_xxx", "credits_950": "prod_yyy", "credits_1900": "prod_zzz"}',
      tip: 'Map the product_id in pricing catalog to the product ID created in Creem. Must be a valid JSON object.',
      group: 'creem',
      tab: 'payment',
    },
    {
      name: 'creem_test_amount',
      title: 'Test amount (cents)',
      type: 'number',
      placeholder: '留空使用实际金额，填 1 则支付 $0.01',
      group: 'creem',
      tab: 'payment',
    },

    // ─── Payment / Waffo Pancake ────────────────────────────────────
    {
      name: 'waffo_enabled',
      title: 'Enable Waffo Pancake',
      type: 'switch',
      group: 'waffo',
      tab: 'payment',
    },
    {
      name: 'waffo_environment',
      title: 'Environment',
      type: 'select',
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      group: 'waffo',
      tab: 'payment',
      defaultValue: 'test',
    },
    {
      name: 'waffo_merchant_id',
      title: 'Merchant ID',
      type: 'text',
      placeholder: 'MER_xxx',
      group: 'waffo',
      tab: 'payment',
    },
    {
      name: 'waffo_private_key',
      title: 'Private Key (PEM)',
      type: 'textarea',
      placeholder: '-----BEGIN PRIVATE KEY-----',
      group: 'waffo',
      tab: 'payment',
    },
    {
      name: 'waffo_webhook_public_key',
      title: 'Webhook Public Key',
      type: 'textarea',
      placeholder: '-----BEGIN PUBLIC KEY-----',
      group: 'waffo',
      tab: 'payment',
    },
    {
      name: 'waffo_product_ids_mapping',
      title: 'Product IDs Mapping',
      type: 'textarea',
      placeholder: '{"lite_monthly": "PROD_xxx", "starter_once": "PROD_yyy"}',
      tip: 'Map each local pricing catalog ID to the Waffo Pancake product ID. Must be valid JSON.',
      group: 'waffo',
      tab: 'payment',
    },

    // ─── Payment / PayPal ────────────────────────────────────────────
    {
      name: 'paypal_enabled',
      title: 'Enable PayPal',
      type: 'switch',
      group: 'paypal',
      tab: 'payment',
    },
    {
      name: 'paypal_client_id',
      title: 'Client ID',
      type: 'text',
      placeholder: 'xxx',
      group: 'paypal',
      tab: 'payment',
    },
    {
      name: 'paypal_client_secret',
      title: 'Client Secret',
      type: 'password',
      placeholder: 'xxx',
      group: 'paypal',
      tab: 'payment',
    },
    {
      name: 'paypal_webhook_id',
      title: 'Webhook ID',
      type: 'text',
      placeholder: 'xxx',
      group: 'paypal',
      tab: 'payment',
    },
    {
      name: 'paypal_environment',
      title: 'Environment',
      type: 'select',
      options: [
        { label: 'Sandbox', value: 'sandbox' },
        { label: 'Live', value: 'live' },
      ],
      group: 'paypal',
      tab: 'payment',
    },
    {
      name: 'paypal_test_amount',
      title: 'Test amount (cents)',
      type: 'number',
      placeholder: '留空使用实际金额，填 1 则支付 $0.01',
      group: 'paypal',
      tab: 'payment',
    },

    // ─── Payment / Alipay ─────────────────────────────────────────────
    {
      name: 'alipay_enabled',
      title: 'Enable Alipay',
      type: 'switch',
      group: 'alipay',
      tab: 'payment',
    },
    {
      name: 'alipay_app_id',
      title: 'App ID',
      type: 'text',
      placeholder: '2021xxx',
      group: 'alipay',
      tab: 'payment',
    },
    {
      name: 'alipay_private_key',
      title: 'Private Key (RSA2)',
      type: 'textarea',
      placeholder: 'MIIEvQIBADANBgkq...',
      group: 'alipay',
      tab: 'payment',
    },
    {
      name: 'alipay_public_key',
      title: 'Alipay Public Key',
      type: 'textarea',
      placeholder: 'MIIBIjANBgkq...',
      group: 'alipay',
      tab: 'payment',
    },
    {
      name: 'alipay_notify_url',
      title: 'Notify URL (Webhook)',
      type: 'text',
      placeholder: 'https://hersoul.cn/api/payment/notify/alipay',
      group: 'alipay',
      tab: 'payment',
    },
    {
      name: 'alipay_test_amount',
      title: 'Test amount (分)',
      type: 'number',
      placeholder: '留空使用实际金额，填 1 则支付 ¥0.01',
      group: 'alipay',
      tab: 'payment',
    },

    // ─── Payment / WeChat Pay ───────────────────────────────────────
    {
      name: 'wechat_enabled',
      title: 'Enable WeChat Pay',
      type: 'switch',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_app_id',
      title: 'AppID',
      type: 'text',
      placeholder: 'wx1234567890',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_mch_id',
      title: 'Merchant ID (商户号)',
      type: 'text',
      placeholder: '1900000001',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_api_v3_key',
      title: 'APIv3 Key (32位密钥)',
      type: 'password',
      placeholder: '32 chars',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_private_key',
      title: 'Merchant Private Key (PEM)',
      type: 'textarea',
      placeholder: 'MIIEvgIBADANBgkq...',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_serial_no',
      title: 'Certificate Serial No',
      type: 'text',
      placeholder: 'xxx',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_notify_url',
      title: 'Notify URL (Webhook)',
      type: 'text',
      placeholder: 'https://hersoul.cn/api/payment/notify/wechat',
      group: 'wechat',
      tab: 'payment',
    },
    {
      name: 'wechat_test_amount',
      title: 'Test amount (分)',
      type: 'number',
      placeholder: '留空使用实际金额，填 1 则支付 ¥0.01',
      group: 'wechat',
      tab: 'payment',
    },

    // ─── Email / General ────────────────────────────────────────────
    {
      name: 'email_provider',
      title: 'Email Provider',
      type: 'select',
      options: [
        { label: 'Resend', value: 'resend' },
        { label: 'Cloudflare Email', value: 'cloudflare' },
      ],
      group: 'email_general',
      tab: 'email',
      defaultValue: 'resend',
    },

    // ─── Email / Resend ──────────────────────────────────────────────
    {
      name: 'resend_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 're_xxx',
      group: 'resend',
      tab: 'email',
    },
    {
      name: 'resend_sender_email',
      title: 'Sender Email',
      type: 'text',
      placeholder: 'hello@example.com',
      group: 'resend',
      tab: 'email',
    },

    // ─── Email / Cloudflare Email ────────────────────────────────────
    {
      name: 'cloudflare_email_api_token',
      title: 'API Token',
      type: 'password',
      placeholder: 'Bearer token with Email Send permission',
      group: 'cloudflare_email',
      tab: 'email',
    },
    {
      name: 'cloudflare_email_account_id',
      title: 'Account ID',
      type: 'text',
      placeholder: 'Cloudflare account ID',
      group: 'cloudflare_email',
      tab: 'email',
    },
    {
      name: 'cloudflare_email_sender_email',
      title: 'Sender Email',
      type: 'text',
      placeholder: 'hello@yourdomain.com',
      group: 'cloudflare_email',
      tab: 'email',
    },

    // ─── Storage / R2 ────────────────────────────────────────────────
    // Keys mirror the original ShipAny Two (`r2_*`) so existing DB config is read as-is.
    {
      name: 'r2_access_key',
      title: 'Cloudflare Access Key',
      type: 'text',
      placeholder: '',
      group: 'r2',
      tab: 'storage',
    },
    {
      name: 'r2_secret_key',
      title: 'Cloudflare Secret Key',
      type: 'password',
      placeholder: '',
      group: 'r2',
      tab: 'storage',
    },
    {
      name: 'r2_bucket_name',
      title: 'Bucket Name',
      type: 'text',
      placeholder: '',
      group: 'r2',
      tab: 'storage',
    },
    {
      name: 'r2_upload_path',
      title: 'Upload Path',
      type: 'text',
      placeholder: 'uploads',
      tip: 'Path to upload files to; leave empty to use the default. Example: uploads/foo/bar',
      group: 'r2',
      tab: 'storage',
    },
    {
      name: 'r2_endpoint',
      title: 'Endpoint',
      type: 'text',
      placeholder: 'https://<account-id>.r2.cloudflarestorage.com',
      tip: 'Leave empty to use the default R2 endpoint',
      group: 'r2',
      tab: 'storage',
    },
    {
      name: 'r2_domain',
      title: 'Domain',
      type: 'text',
      placeholder: 'https://cdn.example.com',
      group: 'r2',
      tab: 'storage',
    },

    // ─── AI / OpenAI ─────────────────────────────────────────────────
    {
      name: 'openai_base_url',
      title: 'Base URL',
      type: 'text',
      placeholder: 'https://api.openai.com/v1',
      group: 'openai',
      tab: 'ai',
    },
    {
      name: 'openai_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 'sk-xxx',
      group: 'openai',
      tab: 'ai',
    },
    {
      name: 'openai_model',
      title: 'Model',
      type: 'text',
      placeholder: 'gpt-4o-mini',
      group: 'openai',
      tab: 'ai',
    },

    // ─── AI / EvoLink ────────────────────────────────────────────────
    // EvoLink (https://evolink.ai) is an OpenAI-compatible gateway: one API key
    // reaches any model in its Text Series. Product chat defaults to Kimi K3
    // (model id `kimi-k3`); users can switch within the curated list.
    {
      name: 'evolink_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 'sk-xxx',
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'evolink_model',
      title: 'Model',
      type: 'text',
      placeholder: 'kimi-k3',
      tip: 'Default product-chat model. Any id from the server allowlist (kimi-k3, glm-5.3-flash, deepseek-v4-flash, MiniMax-M3, glm-5.3, gemini-3.5-flash, claude-sonnet-5, claude-opus-4-8, claude-opus-5, gpt-5.6-sol, claude-fable-5); the chat UI lets users switch among those server-billed routes.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      // Free-tier chat: glm-5.3-flash and deepseek-v4-flash cost a fraction
      // of a credit per message, so they are offered on a daily message
      // allowance instead of per-token billing (see
      // `@/modules/free-chat-quota`). This switch is the kill switch —
      // flipping it off routes those models back through the normal
      // credit gates without a redeploy.
      name: 'free_chat_enabled',
      title: 'Enable free-tier chat models',
      type: 'switch',
      defaultValue: 'true',
      tip: 'GLM-5.3 Flash and DeepSeek V4 Flash on a daily message quota instead of credits (no per-token billing). Off = those models require credits/subscription like the rest.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'free_chat_daily_limit',
      title: 'Free chat messages / user / day',
      type: 'number',
      placeholder: '30',
      defaultValue: '30',
      min: 1,
      tip: 'Free-tier messages per user per day across both free models. Resets at Beijing midnight. Heavy daily use of both models ≈ $0.9–2.4/month per user at wholesale.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'evolink_image_model',
      title: 'Image Model',
      type: 'text',
      placeholder: 'gpt-image-2',
      tip: 'Image generation is currently locked to the verified gpt-image-2 model. The saved value is retained for future provider support but is not submitted until it passes an end-to-end test.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'evolink_image_models_allowlist',
      title: 'Image Model Allowlist',
      type: 'text',
      placeholder: 'gpt-image-2',
      tip: 'Reserved for future verified models. Do not add a model based only on the provider model list; it must complete a real image request first.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'evolink_video_model',
      title: 'Video Model',
      type: 'text',
      placeholder: 'seedance-2.0-text-to-video',
      tip: 'Model id sent to /v1/videos/generations. Default: seedance-2.0-text-to-video.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'evolink_video_models_allowlist',
      title: 'Video Model Allowlist',
      type: 'text',
      placeholder: 'seedance-2.0-text-to-video',
      tip: 'Comma-separated video model ids that clients may submit. Leave empty to accept any model the provider serves. Example: seedance-2.0-text-to-video,seedance-2.0-image-to-video.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'image_credit_cost',
      title: 'Image Credit Cost (legacy)',
      type: 'number',
      placeholder: '5',
      defaultValue: '5',
      tip: 'Legacy flat cost per image, used when `image_credit_markup` is unset. Multiplied by n (= 1–4) at submit time. New deployments should set `image_credit_markup` instead and leave this at 5.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'image_credit_markup',
      title: 'Image Markup Multiplier',
      type: 'number',
      placeholder: '5',
      defaultValue: '5',
      tip: 'Multiplier on the EvoLink wholesale token cost. Default 5× (chat uses 6×). Set to any positive number to enable the wholesale × markup pricing; leave at 0 to keep the legacy flat-cost behavior.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      // First-image-free trial — see `readImageFirstFree` /
      // `isFreeTrialShape` in src/lib/image-billing.ts and the decision in
      // src/routes/api/ai-tasks/-image.ts. Exists because one image (~10 cr)
      // costs more than the whole signup bonus (5 cr), so a new account
      // would otherwise be paywalled on its first click.
      name: 'image_first_free',
      title: 'First image free per user',
      type: 'switch',
      defaultValue: 'true',
      tip: "Skip the credit deduction for a user's first 2 eligible image generations (acquisition funnel). Each request returns 1 free 1K image with no reference image; later generations are charged normally. Failed attempts don't burn the trial.",
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'image_credit_wholesale_per_1k_output',
      title: 'EvoLink Output Wholesale (cr / 1K)',
      type: 'number',
      placeholder: '1.728',
      defaultValue: '1.728',
      tip: 'EvoLink wholesale price for Image Output tokens, in credits per 1K tokens. Update when the EvoLink plan or model pricing changes. Used by `computeImageCost` to compute per-image cost.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'image_credit_wholesale_per_1k_input',
      title: 'EvoLink Input Wholesale (cr / 1K)',
      type: 'number',
      placeholder: '0.4608',
      defaultValue: '0.4608',
      tip: 'EvoLink wholesale price for Image Input tokens (img2img reference images), in credits per 1K tokens. ~3-4× cheaper than output.',
      group: 'evolink',
      tab: 'ai',
    },
    {
      name: 'image_credit_tokens_per_image_1024',
      title: 'Output Tokens per 1024×1024 Image',
      type: 'number',
      placeholder: '1050',
      defaultValue: '1050',
      tip: 'Output tokens consumed by a single 1024×1024 image. 1536×1024 / 1024×1536 use 1.4× this count; 1792×1024 / 1024×1792 use 1.8×. Update when switching to a different model family with different token economics.',
      group: 'evolink',
      tab: 'ai',
    },

    // ─── AI / Seedance 2.0 video via EvoLink ──────────────────────────
    {
      name: 'seedance_video_enabled',
      title: 'Enable Seedance Video',
      type: 'switch',
      defaultValue: 'true',
      group: 'seedance_video',
      tab: 'ai',
    },
    {
      name: 'seedance_video_credits_480p_per_second',
      title: '480p Credits / Second',
      type: 'number',
      placeholder: '1',
      defaultValue: '1',
      group: 'seedance_video',
      tab: 'ai',
    },
    {
      name: 'seedance_video_credits_720p_per_second',
      title: '720p Credits / Second',
      type: 'number',
      placeholder: '2',
      defaultValue: '2',
      group: 'seedance_video',
      tab: 'ai',
    },
    {
      name: 'seedance_video_credits_1080p_per_second',
      title: '1080p Credits / Second',
      type: 'number',
      placeholder: '4',
      defaultValue: '4',
      group: 'seedance_video',
      tab: 'ai',
    },
    {
      name: 'seedance_video_credits_4k_per_second',
      title: '4K Credits / Second',
      type: 'number',
      placeholder: '8',
      defaultValue: '8',
      group: 'seedance_video',
      tab: 'ai',
    },
    {
      name: 'seedance_video_max_concurrent',
      title: 'Max Concurrent Tasks / User',
      type: 'number',
      placeholder: '1',
      defaultValue: '1',
      group: 'seedance_video',
      tab: 'ai',
    },

    // ─── AI / Anthropic ──────────────────────────────────────────────
    {
      name: 'anthropic_base_url',
      title: 'Base URL',
      type: 'text',
      placeholder: 'https://api.anthropic.com',
      group: 'anthropic',
      tab: 'ai',
    },
    {
      name: 'anthropic_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 'sk-ant-xxx',
      group: 'anthropic',
      tab: 'ai',
    },

    // ─── AI / Replicate ──────────────────────────────────────────────
    {
      name: 'replicate_api_token',
      title: 'API Token',
      type: 'password',
      placeholder: 'r8_xxx',
      group: 'replicate',
      tab: 'ai',
    },

    // ─── AI / Fal ────────────────────────────────────────────────────
    {
      name: 'fal_api_key',
      title: 'API Key',
      type: 'password',
      placeholder: 'xxx',
      group: 'fal',
      tab: 'ai',
    },

    // ─── AI / Web & Motion (video → video replicate via Fal) ─────────
    {
      name: 'video_replicate_model',
      title: 'Video Replicate Model',
      type: 'text',
      placeholder: 'fal-ai/kling-video/o1/video-to-video/edit',
      group: 'fal',
      tab: 'ai',
    },
    {
      name: 'video_replicate_credit_cost',
      title: 'Video Replicate Credit Cost',
      type: 'text',
      placeholder: '10',
      group: 'fal',
      tab: 'ai',
    },

    // ─── AI / Screenshot (URL → image for the 网址→克隆 task) ──────────
    {
      name: 'screenshot_api_base',
      title: 'Screenshot API Base URL',
      type: 'text',
      placeholder: 'https://api.screenshotone.com/take',
      tip: 'A GET endpoint that returns image bytes for ?url=. The target URL and key are appended automatically.',
      group: 'screenshot',
      tab: 'ai',
    },
    {
      name: 'screenshot_api_key',
      title: 'Screenshot API Key',
      type: 'password',
      placeholder: 'xxx',
      group: 'screenshot',
      tab: 'ai',
    },

    // ─── Analytics / Google Analytics ────────────────────────────────
    {
      name: 'google_analytics_id',
      title: 'Measurement ID',
      type: 'text',
      placeholder: 'G-XXXXXXXXXX',
      group: 'google_analytics',
      tab: 'analytics',
    },

    // ─── Analytics / Plausible ───────────────────────────────────────
    {
      name: 'plausible_domain',
      title: 'Domain',
      type: 'text',
      placeholder: 'example.com',
      tip: 'The domain registered in your Plausible dashboard',
      group: 'plausible',
      tab: 'analytics',
    },
    {
      name: 'plausible_src',
      title: 'Script Src',
      type: 'text',
      placeholder: 'https://plausible.io/js/script.js',
      tip: 'Use https://plausible.io/js/script.js for cloud, or your self-hosted URL',
      group: 'plausible',
      tab: 'analytics',
    },

    // ─── Customer Service / Crisp ───────────────────────────────────
    {
      name: 'crisp_enabled',
      title: 'Enable Crisp',
      type: 'switch',
      group: 'crisp',
      tab: 'customer_service',
    },
    {
      name: 'crisp_website_id',
      title: 'Website ID',
      type: 'text',
      placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
      group: 'crisp',
      tab: 'customer_service',
    },

    // ─── Customer Service / Tawk.to ─────────────────────────────────
    {
      name: 'tawk_enabled',
      title: 'Enable Tawk.to',
      type: 'switch',
      group: 'tawk',
      tab: 'customer_service',
    },
    {
      name: 'tawk_property_id',
      title: 'Property ID',
      type: 'text',
      placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxx',
      group: 'tawk',
      tab: 'customer_service',
    },
    {
      name: 'tawk_widget_id',
      title: 'Widget ID',
      type: 'text',
      placeholder: '1xxxxx/default',
      group: 'tawk',
      tab: 'customer_service',
    },

    // ─── AI / Website Audit ────────────────────────────────────────────────
    // The audit feature is gated by `audit_enabled` so an admin can disable
    // the entire flow without redeploying. Pricing + first-free + cache +
    // share-link knobs follow the same admin-tunable pattern as the rest of
    // this file (see credits pricing block above).
    {
      name: 'audit_enabled',
      title: 'Enable Website Audit',
      type: 'switch',
      group: 'audit',
      tab: 'ai',
      defaultValue: 'true',
    },
    {
      name: 'audit_first_free',
      title: 'First audit free per user',
      type: 'switch',
      group: 'audit',
      tab: 'ai',
      defaultValue: 'true',
      tip: "Skip the credit deduction for a user's first successful audit (acquisition funnel).",
    },
    {
      name: 'audit_credit_cost',
      title: 'Audit credit cost',
      type: 'number',
      placeholder: '5',
      defaultValue: '5',
      group: 'audit',
      tab: 'ai',
    },
    {
      name: 'audit_max_input_tokens',
      title: 'Max input tokens per audit',
      type: 'number',
      placeholder: '80000',
      defaultValue: '80000',
      group: 'audit',
      tab: 'ai',
      tip: 'Hard cap on the prompt token count we send to the LLM; rejects pages bigger than this.',
    },
    {
      name: 'audit_max_body_bytes',
      title: 'Max page body size (bytes)',
      type: 'number',
      placeholder: '8388608',
      defaultValue: '8388608',
      group: 'audit',
      tab: 'ai',
    },
    {
      name: 'audit_timeout_ms',
      title: 'Audit timeout (ms)',
      type: 'number',
      placeholder: '90000',
      defaultValue: '90000',
      group: 'audit',
      tab: 'ai',
    },
    {
      name: 'audit_llm_provider',
      title: 'LLM provider',
      type: 'select',
      options: [
        { label: 'Evolink (Kimi K3)', value: 'evolink' },
        { label: 'OpenAI (chat-completions)', value: 'openai' },
      ],
      group: 'audit',
      tab: 'ai',
      defaultValue: 'evolink',
    },
    {
      name: 'audit_llm_model',
      title: 'LLM model',
      type: 'text',
      placeholder: 'kimi-k3',
      defaultValue: 'kimi-k3',
      group: 'audit',
      tab: 'ai',
      tip: 'Any OpenAI-compatible model id supported by the chosen provider.',
    },
    {
      name: 'audit_public_share_enabled',
      title: 'Enable public report sharing',
      type: 'switch',
      group: 'audit',
      tab: 'ai',
      defaultValue: 'true',
    },
    {
      name: 'audit_share_token_ttl_days',
      title: 'Share link TTL (days)',
      type: 'number',
      placeholder: '7',
      defaultValue: '7',
      group: 'audit',
      tab: 'ai',
    },
    {
      name: 'audit_cache_ttl_days',
      title: 'Cache TTL (days)',
      type: 'number',
      placeholder: '7',
      defaultValue: '7',
      tip: 'Same-URL re-audit within this window returns the cached report (free).',
      group: 'audit',
      tab: 'ai',
    },
    {
      name: 'audit_global_benchmark_enabled',
      title: 'Show global benchmark percentiles',
      type: 'switch',
      group: 'audit',
      tab: 'ai',
      defaultValue: 'true',
    },

    // ─── AI / MCP Servers ───────────────────────────────────────────
    // Standard MCP client config, stored verbatim in the config table.
    // Consumed later by the chat tool-call loop. Remote/HTTP servers only
    // (url) — this product runs on Cloudflare Workers, which can't spawn
    // stdio MCP processes. Pre-filled with applora so it works out of the
    // box once enabled.
    {
      name: 'mcp_enabled',
      title: 'Enable MCP tools',
      type: 'switch',
      group: 'mcp',
      tab: 'ai',
      defaultValue: 'false',
      tip: 'Expose the configured MCP servers as tools the AI chat can call.',
    },
    {
      name: 'mcp_servers',
      title: 'MCP Servers (JSON)',
      type: 'textarea',
      placeholder:
        '{"mcpServers":{"applora":{"url":"https://applora.ai/mcp"}}}',
      defaultValue:
        '{"mcpServers":{"applora":{"url":"https://applora.ai/mcp"}}}',
      group: 'mcp',
      tab: 'ai',
      tip: 'Standard MCP client config. Remote/HTTP servers only — each entry is { "url": "https://..." }. e.g. {"mcpServers":{"applora":{"url":"https://applora.ai/mcp"}}}',
    },
  ];
}
