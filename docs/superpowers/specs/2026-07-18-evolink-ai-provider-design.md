# EvoLink.ai AI Provider Integration — Design

**Date:** 2026-07-18
**Status:** Approved (Option A — wired to chat)
**Scope:** Add evolink.ai as a first-class, OpenAI-compatible chat provider in Admin → Settings → AI.

## Background

evolink.ai is an AI model API gateway ("One API. Every Model."). It exposes an
**OpenAI-compatible** HTTP API:

- **Base URL:** `https://api.evolink.ai/v1`
- **Auth:** `Authorization: Bearer <api_key>`
- **Chat endpoint:** `POST /v1/chat/completions` (OpenAI request/response shape)
- **Models (Text Series):** EvoLink Auto, Claude, Gemini, GPT, DeepSeek, Kimi-K2,
  MiniMax, Doubao Seed 2.0, … — any of them selectable via the `model` field.

Because it speaks the OpenAI `/chat/completions` shape, the existing
`openaiChatCompletion()` client (`src/core/ai/chat.ts`) works with evolink
unchanged — only the `baseUrl` + `apiKey` differ.

## Current state (why this is low-risk)

The admin settings system is **fully data-driven and self-registering**:

- The settings UI (`src/routes/admin/settings.tsx`) renders from
  `getSettingTabs()` / `getSettingGroups()` / `getSettings()`. A new group +
  fields automatically renders a card with collapse + Test + Save.
- Config storage (`src/modules/config/service.ts`) needs no allowlist edits:
  `password`-type fields are auto-detected as secrets (encrypted at rest +
  masked in the UI), and the `_api_key$` regex covers `evolink_api_key` as a
  fallback.
- The Test button dispatches via `switch (group)` + a `testSpecs` map; adding a
  `case 'evolink'` + spec entry wires the button.
- Chat (`src/modules/chat/service.ts`) currently resolves credentials **only**
  from `openai_*` config — this change extends it to honor a provider selector.

## Design

### 1. `src/modules/config/settings.ts`

- New group **`ai_general`** (tab `ai`, title "Chat") at the top of the AI tab
  with a `select` field `default_chat_provider`, options
  `{OpenAI → openai, EvoLink → evolink}`, **default `openai`** (non-breaking).
- New group **`evolink`** (tab `ai`) with fields:
  - `evolink_base_url` (text, default `https://api.evolink.ai/v1`)
  - `evolink_api_key` (password)
  - `evolink_model` (text, default `gpt-4o-mini`)
- Add `openai_model` (text, default `gpt-4o-mini`) to the existing `openai`
  group — the chat service already reads this key but it had no settings field.

### 2. `src/modules/chat/service.ts`

- Extend `getChatModelConfig()` to read `default_chat_provider`, then resolve
  `{apiKey, baseUrl, model, provider}` from the chosen provider's config:
  - `openai` → `openai_api_key` / `openai_base_url` / `openai_model`
  - `evolink` → `evolink_api_key` / `evolink_base_url` / `evolink_model`
  - Env fallbacks preserved (`OPENAI_*`). `hasKey` reflects the chosen provider.
- `createChat` / `sendMessage`: store `cfg.provider` (instead of hardcoded
  `'openai'`) so chat rows reflect the real provider. No-key path unchanged.

### 3. `src/modules/config/settings-test-specs.ts`

- Add `evolink` test spec (model + prompt fields), mirroring the `openai` spec.

### 4. `src/modules/config/settings-test.ts`

- Add `case 'evolink'` running the OpenAI-compatible `/chat/completions` test
  against `evolink_base_url` + `evolink_api_key`. Extract a small shared helper
  `testChatCompletion({baseUrl, apiKey, model, prompt, label})` used by both
  `testOpenAI` and the new `testEvoLink` (DRY; no behavior change to OpenAI).

### 5. `messages/en.json` + `messages/zh.json`

New i18n keys (flat dot-keyed, both locales):

- `admin.settings.groups.ai_general.title` / `.description`
- `admin.settings.groups.evolink.title` / `.description`
- `admin.settings.fields.default_chat_provider`
- `admin.settings.fields.evolink_base_url`
- `admin.settings.fields.evolink_api_key`
- `admin.settings.fields.evolink_model`
- `admin.settings.fields.openai_model`

(Select option labels stay hardcoded English, matching the existing
`email_provider` / `default_payment_provider` pattern.)

## Out of scope (YAGNI)

- evolink image / video / audio generation endpoints — only LLM chat is wired.
- Per-chat model picker in the chat UI — separate feature.

## Verification

- `pnpm build` passes.
- Manual: Admin → Settings → AI shows the new `Chat` selector + `EvoLink` card;
  entering an evolink key, switching the selector to EvoLink, and chatting
  returns a real model response; the Test button on the EvoLink card succeeds.
