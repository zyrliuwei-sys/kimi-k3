import { toNextJsHandler } from 'better-auth/next-js';
import { getAuth } from '@/core/auth';
import { getDbConfigs } from '@/modules/config/service';

async function getHandler() {
  const configs = await getDbConfigs();
  const auth = getAuth(configs);
  return toNextJsHandler(auth.handler);
}

export async function GET(req: Request) {
  const handler = await getHandler();
  return handler.GET(req);
}

export async function POST(req: Request) {
  const handler = await getHandler();
  return handler.POST(req);
}
