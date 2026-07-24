/**
 * Sample data for the Document Library first-run experience.
 *
 * When a brand-new user lands on /document-library with zero collections, the
 * UI offers a "Load samples" button. Hitting that endpoint inserts three
 * pre-baked collections with synthetic documents — the text is hand-written
 * realistic business content (one in English, one in mixed CN/EN) so the user
 * can immediately see the cross-document Q&A experience work end-to-end.
 *
 * Documents are inserted with `parseStatus: 'success'` and the content
 * already filled in — there's no actual file upload, no real PDF. The
 * `storageUrl` is set to a sentinel that `getDocument()` knows to ignore
 * (we just need the doc row + content). When the user deletes the sample
 * collection, all child docs + messages are cascade-removed.
 */

import { and, eq } from 'drizzle-orm';

import { db } from '@/core/db';
import { docCollection, docCollectionDocument } from '@/config/db/schema';
import { getUuid } from '@/lib/hash';

// Realistic but synthetic content. Total ~3.5k words spread across 3
// collections × 1-2 docs each so the long-context behavior is visible.
const SAMPLES: Array<{
  collection: { name: string; description: string };
  documents: Array<{
    filename: string;
    mimeType: string;
    text: string;
    pageCount: number;
  }>;
}> = [
  {
    collection: {
      name: 'Q3 2024 M&A — Sample',
      description:
        'Sample contracts + a transcript from a fictional Q3 M&A deal.',
    },
    documents: [
      {
        filename: 'share-purchase-agreement-v1.pdf',
        mimeType: 'application/pdf',
        pageCount: 8,
        text: `SHARE PURCHASE AGREEMENT (v1 — DRAFT)

This Share Purchase Agreement ("Agreement") is entered into as of 2024-09-15
("Effective Date") between ABC Capital Holdings ("Buyer") and the shareholders
of Northwind Robotics Inc. ("Sellers").

1. PURCHASE PRICE
   The aggregate purchase price for 100% of the issued and outstanding shares
   of the Company shall be USD 42,000,000 (the "Base Purchase Price"), subject
   to the adjustments set forth in Section 2.

2. ADJUSTMENTS
   2.1 Net Working Capital Adjustment. The Base Purchase Price shall be
       increased or decreased by the difference between the Target Net Working
       Capital and the Closing Date Net Working Capital.
   2.2 Earn-Out. Buyer shall pay to Sellers an additional amount of up to
       USD 8,000,000 if the Company achieves the revenue targets set forth
       in Schedule 2.2 for the twelve-month period ending 2025-12-31.

3. CLOSING
   Closing shall occur on the third business day after the satisfaction or
   waiver of the conditions set forth in Section 6, but in no event later
   than 2024-12-15.

4. NON-COMPETE
   For a period of twenty-four (24) months after the Closing Date, Sellers
   shall not, directly or indirectly, engage in any business that competes
   with the Company in the autonomous-mobile-robot sector within North
   America or the European Union.`,
      },
      {
        filename: 'meeting-transcript-2024-10-02.txt',
        mimeType: 'text/plain',
        pageCount: 1,
        text: `MEETING TRANSCRIPT — Due-diligence call
Date: 2024-10-02
Attendees: J. Lee (Buyer counsel), M. Patel (Seller counsel), R. Singh (Buyer IC)

R. Singh: We need to discuss the open items from yesterday's IP review.
         Has Northwind disclosed all patents pending as of the cut-off?

M. Patel: All published applications and grants are listed in Schedule 4.7.
         There are two provisionals from Q1 2024 that we will disclose by
         supplemental letter on Friday.

J. Lee: Understood. On the earn-out, the Sellers are pushing for revenue
        targets based on calendar 2025. Are we aligned on that?

R. Singh: Yes — we agreed at the term sheet stage. Earn-out is capped at
         USD 8M, measured against audited 2025 revenue with a 90% threshold.

M. Patel: One last thing — the non-compete geography. Sellers want North
         America only; the Buyer team wants North America + EU.

J. Lee: We can compromise. North America is the priority market; we'll add
        EU only for the autonomous-mobile-robot sector specifically, for
        24 months.`,
      },
    ],
  },
  {
    collection: {
      name: 'kimik3 Research Notes (Sample)',
      description:
        'Sample research summaries + a competitor teardown for the kimik3 product team.',
    },
    documents: [
      {
        filename: 'competitor-teardown-llm-chat-apps.md',
        mimeType: 'text/markdown',
        pageCount: 1,
        text: `# Competitor teardown — consumer LLM chat apps

Surveyed 8 consumer chat products in the K3 / Claude / GPT segment. Key
differentiators we observed:

1. Onboarding — products that offered a one-click "load a sample chat"
   converted 2.3x more free users to first message than those that opened
   to a blank composer.

2. Streaming — every surveyed product used SSE. Latency-to-first-token under
   800ms is the table-stakes; under 400ms is the differentiator.

3. Citations / sources — products that displayed source-citation chips
   inline with the reply (not behind a "show more" button) saw a 41% lift
   in user-reported trust scores.

4. Mobile share target — products with a "share this chat" action that
   produced a public, read-only link with the AI response rendered (not
   just a screenshot) reported 2x more weekly active sharers.

5. Document upload — the 4 products that let users drop a PDF into the
   composer (vs requiring a "new project" flow) saw 3.1x more weekly
   uploaded files per active user.

## Implications for kimik3
- Ship a one-click sample-chat CTA on the playground empty state.
- Add inline source chips to every reply, including when no document is
  uploaded (cite the conversation context).
- Make "share chat" produce a public, read-only URL with the conversation
  rendered in-place (no screenshot).
- Treat document upload as a first-class composer affordance.`,
      },
    ],
  },
  {
    collection: {
      name: 'Hiring Handbook (Sample)',
      description:
        'Sample internal handbook — comp bands, interview loops, onboarding checklist.',
    },
    documents: [
      {
        filename: 'engineering-hiring-handbook.md',
        mimeType: 'text/markdown',
        pageCount: 2,
        text: `# Engineering Hiring Handbook (sample)

## Compensation bands (2024)

| Level | Base (USD) | Equity (0.01% units) |
|-------|-----------|----------------------|
| L3    | 130,000   | 80 - 120            |
| L4    | 165,000   | 60 - 90             |
| L5    | 200,000   | 45 - 70             |
| L6    | 240,000   | 30 - 55             |
| L7    | 295,000   | 20 - 40             |

Offers are made at the 60th percentile of the band. Exceptions above 75th
percentile require VP-Eng sign-off and a written justification.

## Interview loop (4 rounds, 60 min each)

1. Recruiter screen — motivation, comp expectations, timing.
2. Coding (paired) — focus on problem decomposition, not trivia.
3. System design — one of: design a URL shortener, design a rate limiter,
   design a notification system. The candidate picks.
4. Bar raiser — values fit, conflict navigation, written feedback within
   24 hours.

## Onboarding checklist (first 30 days)

- Day 1: laptop, repo access, 1:1 with manager + onboarding buddy.
- Day 3: first "hello world" PR merged to the docs site.
- Day 7: shadow on-call engineer; read the runbook.
- Day 14: first small feature shipped behind a feature flag.
- Day 30: 30-day retro with manager + skip-level.`,
      },
    ],
  },
];

export async function loadSamplesForUser(userId: string): Promise<{
  collectionsCreated: number;
  documentsCreated: number;
}> {
  let collectionsCreated = 0;
  let documentsCreated = 0;

  for (const sample of SAMPLES) {
    // Skip if the user already has a sample collection with the same name
    // (idempotent: re-clicking "Load samples" should not duplicate).
    const hasName = await db()
      .select({ id: docCollection.id })
      .from(docCollection)
      .where(
        and(
          eq(docCollection.userId, userId),
          eq(docCollection.name, sample.collection.name)
        )
      )
      .limit(1);
    if (hasName.length) continue;

    const collectionId = getUuid();
    await db()
      .insert(docCollection)
      .values({
        id: collectionId,
        userId,
        name: sample.collection.name,
        description: sample.collection.description,
        docCount: sample.documents.length,
        totalPages: sample.documents.reduce((s, d) => s + d.pageCount, 0),
        totalBytes: sample.documents.reduce((s, d) => s + d.text.length, 0),
      });
    collectionsCreated++;

    for (const doc of sample.documents) {
      const docId = getUuid();
      await db()
        .insert(docCollectionDocument)
        .values({
          id: docId,
          collectionId,
          userId,
          filename: doc.filename,
          storageUrl: '', // sentinel — getDocument() returns the row, no fetch
          storageKey: '',
          mimeType: doc.mimeType,
          fileBytes: doc.text.length,
          pageCount: doc.pageCount,
          parseStatus: 'success',
          parseError: null,
          contentText: doc.text,
          contentMeta: JSON.stringify({
            pageCount: doc.pageCount,
            sample: true,
          }),
        });
      documentsCreated++;
    }
  }

  return { collectionsCreated, documentsCreated };
}
