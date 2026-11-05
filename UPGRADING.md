## 2026-11-05 — Automatic badge installation

Deploy `POST /api/integrations/footer-badges`, set the server-only
`FOOTER_BADGE_AUTOMATION_TOKEN_HASH` to the SHA-256 hash of a dedicated per-site
credential, then connect the matching owned website in Backlora. Empty disables
the endpoint. This grants only badge check/add access, never administrator access.
No schema, login identity or role migration is required.

Official text links and inert verification attributes now survive validation,
storage and server rendering. Automatic additions merge atomically by exact href
and are safe to retry. Existing administrator APIs keep their current contracts.
Run `pnpm test:footer-badge-integration`, `pnpm test:footer-badge-integration:d1`
and `pnpm build` before deploying through `pnpm run cf:deploy`.
