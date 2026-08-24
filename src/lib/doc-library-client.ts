import { ApiError } from '@/lib/api-client';

export interface DocumentUploadResult {
  filename: string;
  ok: boolean;
  id?: string;
  parseStatus?: string;
  parseError?: string | null;
  pageCount?: number;
  fileBytes?: number;
  error?: string;
}

/**
 * Multipart is intentionally kept out of React components. The normal
 * api-client serializes JSON, while document uploads must preserve FormData's
 * browser-managed boundary header.
 */
export async function uploadLibraryDocuments(
  collectionId: string,
  files: File[]
): Promise<{ results: DocumentUploadResult[] }> {
  const form = new FormData();
  form.set('collectionId', collectionId);
  for (const file of files) form.append('files', file);

  const response = await fetch('/api/doc-library/document', {
    method: 'POST',
    body: form,
  });
  const payload = await response
    .json()
    .catch(() => ({ code: -1, message: response.statusText }));

  if (!response.ok || payload.code !== 0) {
    throw new ApiError(
      payload.code ?? response.status ?? -1,
      payload.message || 'Upload failed',
      payload.data
    );
  }

  return payload.data as { results: DocumentUploadResult[] };
}
