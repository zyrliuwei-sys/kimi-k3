import { respData } from '@/lib/resp';
import { getAllConfigs, filterPublicConfigs } from '@/modules/config/service';

const publicKeys = [
  'google_auth_enabled',
  'github_auth_enabled',
];

export async function GET() {
  const configs = await getAllConfigs();
  return respData(filterPublicConfigs(configs, publicKeys));
}
