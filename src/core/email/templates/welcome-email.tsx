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

export function WelcomeEmail({
  appName = 'kimik3',
  logoUrl,
  name,
  bonusCredits,
  ctaUrl,
}: {
  appName?: string;
  logoUrl?: string;
  name?: string;
  /** Free signup bonus — shown as a green pill so the value is unmistakable. */
  bonusCredits?: number;
  ctaUrl?: string;
}) {
  const greeting = name ? `Hi ${name},` : 'Hi there,';
  return (
    <Html>
      <Head />
      <Preview>{`Welcome to ${appName} — ${bonusCredits ?? 10} free credits to start`}</Preview>
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

            <Heading style={styles.title}>{greeting}</Heading>
            <Text style={styles.lede}>
              Welcome to <strong>{appName}</strong> — your AI workspace for
              chat, research, and content. We're glad you're here.
            </Text>

            {typeof bonusCredits === 'number' && bonusCredits > 0 && (
              <Section style={styles.bonusBox}>
                <Text style={styles.bonusLabel}>YOUR SIGNUP BONUS</Text>
                <Text style={styles.bonusValue}>
                  {bonusCredits} free credits
                </Text>
                <Text style={styles.bonusSub}>
                  Already on your account — try the playground now, no card
                  required.
                </Text>
              </Section>
            )}

            <Text style={styles.paragraph}>
              A few things you can do right away:
            </Text>
            <Text style={styles.bullet}>
              • <strong>Chat with Kimi K3</strong> in the free playground —
              paste a long doc, ask anything, get a real answer in seconds.
            </Text>
            <Text style={styles.bullet}>
              • <strong>Build with the API</strong> — copy-ready Python and curl
              snippets in the docs.
            </Text>
            <Text style={styles.bullet}>
              • <strong>Generate images</strong> — toggle the wand button in the
              composer to switch modes.
            </Text>

            {ctaUrl && (
              <Section style={styles.ctaRow}>
                <Button href={ctaUrl} style={styles.cta}>
                  Open {appName}
                </Button>
              </Section>
            )}

            <Hr style={styles.hr} />
            <Text style={styles.footer}>
              You're receiving this because you just created an account. If that
              wasn't you, please ignore this email.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Inline styles — most email clients strip <style> blocks.
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
  brandRow: {
    marginBottom: 20,
  },
  brandLogo: {
    borderRadius: 8,
    display: 'block',
  },
  brandFallback: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  title: {
    fontSize: 24,
    lineHeight: '30px',
    fontWeight: 600,
    color: '#0f172a',
    margin: '0 0 12px',
  },
  lede: {
    fontSize: 15,
    lineHeight: '23px',
    color: '#334155',
    margin: '0 0 20px',
  },
  bonusBox: {
    background: 'linear-gradient(135deg,#f5f3ff 0%,#fdf4ff 100%)',
    border: '1px solid #ddd6fe',
    borderRadius: 12,
    padding: '18px 20px',
    margin: '0 0 24px',
    textAlign: 'center' as const,
  },
  bonusLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: '#7c3aed',
    letterSpacing: '0.12em',
    margin: '0 0 4px',
  },
  bonusValue: {
    fontSize: 28,
    lineHeight: '34px',
    fontWeight: 700,
    color: '#5b21b6',
    margin: '0 0 4px',
  },
  bonusSub: {
    fontSize: 12,
    color: '#6b21a8',
    margin: 0,
  },
  paragraph: {
    fontSize: 14,
    lineHeight: '22px',
    color: '#334155',
    margin: '0 0 8px',
  },
  bullet: {
    fontSize: 14,
    lineHeight: '22px',
    color: '#334155',
    margin: '0 0 6px',
  },
  ctaRow: {
    textAlign: 'center' as const,
    margin: '28px 0 8px',
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
};
