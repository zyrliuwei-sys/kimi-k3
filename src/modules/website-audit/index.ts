/**
 * Website Auditor — module barrel.
 *
 * IMPORTANT: this barrel MUST stay free of server-only side effects. Vite
 * bundles any `import` in the chain when a client component imports from
 * `@/modules/website-audit` — and that pulls `node:dns/promises` into the
 * browser bundle, which errors at build time.
 *
 * Rule:
 *   - schema (pure types)         → ✅ barrel
 *   - cursor-prompt (pure JS)     → ✅ barrel (client uses these)
 *   - everything else (uses DB,
 *     node:dns, zod-runtime,
 *     server fetch)               → ❌ do not re-export from the barrel;
 *                                       consumers import the file directly.
 *
 * Server-side consumers (API routes, server fns) use direct paths:
 *   `import { runAudit } from '@/modules/website-audit/service';`
 */

// ─── Pure types + zod schemas (no runtime side effects) ──────────────────

export * from './schema';

// ─── Client-safe runtime helpers (no DB / no node modules) ────────────────

export {
  cursorDeepLink,
  batchAsMarkdown,
  normalizeCursorPrompt,
  severityBadge,
  type FindingLike,
  type BatchOptions,
} from './cursor-prompt';
