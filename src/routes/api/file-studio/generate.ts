import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getConfig } from '@/modules/config/service';
import * as fileStudio from '@/modules/file-studio/service';
import { respData, respErr } from '@/lib/resp';

async function resolveModelConfig() {
  const evolinkApiKey = (await getConfig('evolink_api_key')) || '';
  if (evolinkApiKey) {
    return {
      apiKey: evolinkApiKey,
      baseUrl:
        (await getConfig('evolink_base_url')) || 'https://api.evolink.ai/v1',
      model: (await getConfig('evolink_model')) || 'kimi-k3',
    };
  }

  // Evolink is the verified chat route in this project. A separate OpenAI key
  // exists, but its endpoint is not presently a valid API URL; falling back to
  // it would turn a recoverable provider outage into a request failure. The
  // service instead produces its clearly-labelled local draft artifact.
  return null;
}

async function POST({ request }: { request: Request }) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return respErr('Unauthorized', { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    kind?: string;
    prompt?: string;
    template?: string;
  };
  if (body.kind !== 'pptx' && body.kind !== 'docx' && body.kind !== 'xlsx') {
    return respErr('Choose PPTX, DOCX, or XLSX', { status: 400 });
  }
  if (typeof body.prompt !== 'string') {
    return respErr('A brief is required', { status: 400 });
  }
  if (
    body.template !== undefined &&
    body.template !== 'business' &&
    body.template !== 'modern' &&
    body.template !== 'minimal' &&
    body.template !== 'creative'
  ) {
    return respErr('Choose a valid file template', { status: 400 });
  }

  try {
    const artifact = await fileStudio.generate({
      kind: body.kind,
      prompt: body.prompt,
      template: body.template,
      model: await resolveModelConfig(),
    });
    return respData(artifact);
  } catch (error) {
    return respErr(
      error instanceof Error ? error.message : 'Could not generate this file',
      { status: 500 }
    );
  }
}

export const Route = createFileRoute('/api/file-studio/generate')({
  server: { handlers: { POST } },
});
