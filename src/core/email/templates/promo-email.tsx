import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export function PromoEmail({
  appName = 'kimik3',
  logoUrl,
  name,
  headline,
  body,
  ctaText,
  ctaUrl,
  expiresAt,
  promoCode,
  discountLabel,
}: {
  appName?: string;
  logoUrl?: string;
  name?: string;
  /** Short punchy headline. e.g. "50% off all credit packs this week." */
  headline?: string;
  /** 1-3 sentence pitch explaining the offer. */
  body?: string;
  ctaText?: string;
  ctaUrl?: string;
  /** Optional deadline to drive urgency. */
  expiresAt?: string;
  /** Optional coupon code — rendered as a copy-to-clipboard badge. */
  promoCode?: string;
  /** e.g. "Save 30%" — small label above the code. */
  discountLabel?: string;
}) {
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  return (
    <Html>
      <Head />
      <Preview>{headline ?? `Special offer from ${appName}`}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.card}>
            <Section style={styles.accentBar} />
            {(logoUrl || appName) && (
              <Section style={styles.brandRow}>
                {logoUrl ? (
                  <Img
                    src={logoUrl}
                    width="40"
                    height="40"
                    alt={appName}
                    style={styles.brandLogo}
                  />
                ) : (
                  <span style={styles.brandFallback}>{appName}</span>
                )}
              </Section>
            )}

            {discountLabel && (
              <Section style={styles.ribbon}>
                <Text style={styles.ribbonText}>{discountLabel}</Text>
              </Section>
            )}

            <Heading style={styles.title}>{headline}</Heading>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.lede}>{body}</Text>

            {promoCode && (
              <Section style={styles.codeBox}>
                <Text style={styles.codeLabel}>YOUR CODE</Text>
                <Text style={styles.codeValue}>{promoCode}</Text>
                {expiresAt && (
                  <Text style={styles.codeExpiry}>Expires {expiresAt}</Text>
                )}
              </Section>
            )}

            {ctaUrl && ctaText && (
              <Section style={styles.ctaRow}>
                <Button href={ctaUrl} style={styles.cta}>
                  {ctaText}
                </Button>
              </Section>
            )}

            <Hr style={styles.hr} />
            <Text style={styles.footer}>
              You're receiving this because you have an account on {appName}.
              Don't want promo emails?{' '}
              <a
                href={`${ctaUrl?.split('/').slice(0, 3).join('/') ?? ''}/settings`}
                style={styles.footerLink}
              >
                Unsubscribe in settings
              </a>
              .
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: {
    margin: 0,
    padding: 0,
    backgroundColor: '#f6f9fc',
    fontFamily:
      '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Inter,Helvetica,Arial,sans-serif',
    color: '#0f172a',
  },
  container: {
    maxWidth: 560,
    margin: '0 auto',
    padding: '32px 16px 40px',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: '36px 32px',
    border: '1px solid #e5e7eb',
    boxShadow: '0 8px 24px -16px rgba(15, 23, 42, 0.12)',
    overflow: 'hidden' as const,
  },
  accentBar: {
    height: 4,
    background: 'linear-gradient(90deg,#7c3aed 0%,#a855f7 50%,#ec4899 100%)',
    margin: '-36px -32px 24px',
  },
  brandRow: { marginBottom: 16 },
  brandLogo: { borderRadius: 8, display: 'block' },
  brandFallback: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  ribbon: {
    display: 'inline-block' as const,
    background: '#fef3c7',
    border: '1px solid #fde68a',
    borderRadius: 999,
    padding: '4px 12px',
    marginBottom: 16,
  },
  ribbonText: {
    fontSize: 11,
    fontWeight: 700,
    color: '#92400e',
    letterSpacing: '0.1em',
    margin: 0,
  },
  title: {
    fontSize: 26,
    lineHeight: '32px',
    fontWeight: 700,
    color: '#0f172a',
    margin: '0 0 8px',
    letterSpacing: '-0.01em',
  },
  greeting: {
    fontSize: 14,
    color: '#64748b',
    margin: '0 0 16px',
  },
  lede: {
    fontSize: 15,
    lineHeight: '23px',
    color: '#334155',
    margin: '0 0 20px',
  },
  codeBox: {
    background: 'linear-gradient(135deg,#f5f3ff 0%,#fdf4ff 100%)',
    border: '1px solid #ddd6fe',
    borderRadius: 12,
    padding: '20px',
    margin: '0 0 24px',
    textAlign: 'center' as const,
  },
  codeLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#7c3aed',
    letterSpacing: '0.12em',
    margin: '0 0 6px',
  },
  codeValue: {
    fontSize: 26,
    lineHeight: '32px',
    fontWeight: 700,
    color: '#5b21b6',
    letterSpacing: '0.05em',
    fontFamily: 'ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace',
    margin: '0 0 4px',
  },
  codeExpiry: {
    fontSize: 12,
    color: '#6b21a8',
    margin: 0,
  },
  ctaRow: {
    textAlign: 'center' as const,
    margin: '8px 0 8px',
  },
  cta: {
    backgroundColor: '#7c3aed',
    color: '#ffffff',
    fontSize: 14,
    fontWeight: 600,
    padding: '12px 24px',
    borderRadius: 10,
    textDecoration: 'none',
    display: 'inline-block',
  },
  hr: {
    border: 'none',
    borderTop: '1px solid #e5e7eb',
    margin: '24px 0 16px',
  },
  footer: {
    fontSize: 12,
    lineHeight: '18px',
    color: '#94a3b8',
    margin: 0,
    textAlign: 'center' as const,
  },
  footerLink: {
    color: '#7c3aed',
    textDecoration: 'underline',
  },
};
