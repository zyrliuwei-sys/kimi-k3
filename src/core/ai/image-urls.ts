/**
 * Pull every image URL out of any provider response we know how to read.
 *
 * Different gateways return the result of an image generation in wildly
 * different shapes — OpenAI's `data[]`, common variants `images[]`,
 * `result[]`, `output[]`, or a bare array. Each item may carry the image
 * as `url`, `image_url`, or `b64_json` — we translate the last to a
 * `data:` URL so the browser can render it directly.
 *
 * Centralized so the submit (sync) path, the polling path, the list
 * thumbnail, and the preview page all agree on what counts as an image
 * URL. Adding a new provider only requires touching this one file.
 */

interface ImageUrlCandidate {
  url?: string;
  image_url?: string;
  imageUrl?: string;
  output_url?: string;
  b64_json?: string;
}

/**
 * Extract image URLs from a provider response. Returns an empty array
 * when nothing matches — callers should treat that as "still processing"
 * and not as a hard error.
 */
export function extractImageUrls(data: unknown): string[] {
  if (!data || typeof data !== 'object') return [];
  const obj = data as Record<string, any>;

  // Try the standard array-shaped fields first.
  const arrayCandidates: Array<unknown> = [
    obj.data,
    obj.images,
    obj.image_urls,
    obj.imageUrls,
    obj.result,
    obj.result_data,
    obj.output,
    obj.outputs,
    obj.results,
    Array.isArray(obj) ? obj : null,
  ].filter(Array.isArray);

  for (const arr of arrayCandidates) {
    const urls = urlsFromArray(arr as Array<unknown>);
    if (urls.length) return urls;
  }

  // Single-string fallbacks (some gateways return the URL directly
  // on the response root or under a nested key).
  const stringCandidates: Array<string | undefined> = [
    obj.url,
    obj.image_url,
    obj.imageUrl,
    obj.output_url,
    typeof obj.data === 'string' ? obj.data : undefined,
  ];
  for (const url of stringCandidates) {
    if (typeof url === 'string' && url.length) return [url];
  }

  return [];
}

function urlsFromArray(arr: Array<unknown>): string[] {
  const out: string[] = [];
  for (const raw of arr) {
    if (typeof raw === 'string' && raw.length) {
      out.push(raw);
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as ImageUrlCandidate;
    if (typeof item.url === 'string' && item.url.length) {
      out.push(item.url);
    } else if (typeof item.image_url === 'string' && item.image_url.length) {
      out.push(item.image_url);
    } else if (typeof item.imageUrl === 'string' && item.imageUrl.length) {
      out.push(item.imageUrl);
    } else if (typeof item.output_url === 'string' && item.output_url.length) {
      out.push(item.output_url);
    } else if (typeof item.b64_json === 'string' && item.b64_json.length) {
      out.push(`data:image/png;base64,${item.b64_json}`);
    }
  }
  return out;
}
