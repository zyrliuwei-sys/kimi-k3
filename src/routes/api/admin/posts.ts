import { createFileRoute } from '@tanstack/react-router';

import { getAuth } from '@/core/auth';
import { getAllConfigs } from '@/modules/config/service';
import { submitIndexNowUrls } from '@/modules/indexnow/service';
import * as postsService from '@/modules/posts/service';
import { hasPermission } from '@/modules/rbac/service';
import { respData, respErr, respOk, respPage } from '@/lib/resp';

async function checkAdmin(request: Request) {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) throw new Error('Unauthorized');
  const isAdmin = await hasPermission(session.user.id, 'admin.*');
  if (!isAdmin) throw new Error('Forbidden');
  return session;
}

/**
 * Search engine notification must never make a saved article fail. Awaiting
 * the request lets serverless runtimes finish it, while errors are logged for
 * operators and deliberately kept out of the authoring response.
 */
async function notifyChangedPostSlugs(slugs: Array<string | undefined>) {
  const distinctSlugs = [...new Set(slugs.filter(Boolean))] as string[];
  if (distinctSlugs.length === 0) return;

  try {
    const configs = await getAllConfigs();
    const origin = new URL(configs.app_url);
    const urls = distinctSlugs.map(
      (slug) => new URL(`/blog/${encodeURIComponent(slug)}`, origin).href
    );
    const result = await submitIndexNowUrls({ config: configs, urls });
    if (!result.accepted && !result.skipped) {
      console.warn('[indexnow] post notification rejected:', result.message);
    }
  } catch (error) {
    console.warn('[indexnow] post notification failed:', error);
  }
}

async function GET({ request }: { request: Request }) {
  try {
    await checkAdmin(request);
    const { searchParams } = new URL(request.url);

    // Single post (with content) — used by the editor
    const id = searchParams.get('id');
    if (id) {
      const post = await postsService.getById(id);
      if (!post) return respErr('Post not found');
      return respData(post);
    }

    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('pageSize') || '10'))
    );
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') || undefined;

    const { items, total } = await postsService.list({
      search,
      status,
      page,
      pageSize,
    });
    return respPage(items, total);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

async function POST({ request }: { request: Request }) {
  try {
    const session = await checkAdmin(request);
    const {
      slug,
      title,
      description,
      image,
      content,
      categories,
      authorName,
      status,
    } = await request.json();
    if (!slug || !title) return respErr('slug and title are required');
    const result = await postsService.create({
      userId: session.user.id,
      slug,
      title,
      description,
      image,
      content,
      categories,
      authorName,
      status,
    });
    if (result?.status === postsService.PostStatus.PUBLISHED) {
      await notifyChangedPostSlugs([result.slug]);
    }
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

async function PUT({ request }: { request: Request }) {
  try {
    await checkAdmin(request);
    const {
      id,
      slug,
      title,
      description,
      image,
      content,
      categories,
      authorName,
      status,
    } = await request.json();
    if (!id) return respErr('ID is required');
    const previous = await postsService.getById(id);
    const result = await postsService.update(id, {
      slug,
      title,
      description,
      image,
      content,
      categories,
      authorName,
      status,
    });
    const wasPublished = previous?.status === postsService.PostStatus.PUBLISHED;
    const isPublished = result?.status === postsService.PostStatus.PUBLISHED;
    if (wasPublished || isPublished) {
      await notifyChangedPostSlugs([
        wasPublished ? previous?.slug : undefined,
        isPublished ? result?.slug : undefined,
      ]);
    }
    return respData(result);
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

async function DELETE({ request }: { request: Request }) {
  try {
    await checkAdmin(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return respErr('ID is required');
    const previous = await postsService.getById(id);
    await postsService.remove(id);
    if (previous?.status === postsService.PostStatus.PUBLISHED) {
      await notifyChangedPostSlugs([previous.slug]);
    }
    return respOk();
  } catch (error: any) {
    return respErr(error.message || 'Internal error');
  }
}

export const Route = createFileRoute('/api/admin/posts')({
  server: {
    handlers: { GET, POST, PUT, DELETE },
  },
});
