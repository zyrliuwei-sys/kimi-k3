import type {
  StorageConfigs,
  StorageDownloadUploadOptions,
  StorageProvider,
  StorageUploadOptions,
  StorageUploadResult,
} from '.';

/**
 * R2 storage provider configs
 * @docs https://developers.cloudflare.com/r2/
 */
export interface R2Configs extends StorageConfigs {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  uploadPath?: string;
  region?: string;
  endpoint?: string;
  publicDomain?: string;
}

/**
 * R2 storage provider implementation
 * @website https://www.cloudflare.com/products/r2/
 */
export class R2Provider implements StorageProvider {
  readonly name = 'r2';
  configs: R2Configs;

  constructor(configs: R2Configs) {
    this.configs = configs;
  }

  private getUploadPath() {
    let uploadPath = this.configs.uploadPath || 'uploads';
    if (uploadPath.startsWith('/')) {
      uploadPath = uploadPath.slice(1);
    }
    if (uploadPath.endsWith('/')) {
      uploadPath = uploadPath.slice(0, -1);
    }
    return uploadPath;
  }

  private getEndpoint() {
    return (
      this.configs.endpoint ||
      `https://${this.configs.accountId}.r2.cloudflarestorage.com`
    );
  }

  getPublicUrl = (options: { key: string; bucket?: string }) => {
    const uploadBucket = options.bucket || this.configs.bucket;
    const uploadPath = this.getUploadPath();
    // R2 quirk: the bucket name is part of the object key itself
    // (LIST returns `<bucket>/uploads/...`). The public r2.dev URL
    // must mirror that path — the public CDN strips the bucket
    // prefix only when the URL is rewritten through the custom
    // domain, but for the r2.dev default the bucket is required.
    return this.configs.publicDomain
      ? `${this.configs.publicDomain}/${uploadBucket}/${uploadPath}/${options.key}`
      : `${this.getEndpoint()}/${uploadBucket}/${uploadPath}/${options.key}`;
  };

  /**
   * Generate a presigned GET URL valid for `expiresInSeconds`.
   *
   * The custom `publicDomain` (e.g. `pub-…r2.dev`) only works when the
   * bucket has public access enabled. When it doesn't (401 in practice),
   * we fall back to signing a GET against the S3-compatible endpoint
   * so the browser can fetch the image without auth headers.
   *
   * Default 7 days — long enough for the playground to keep working
   * across user sessions, short enough that a leaked URL self-expires.
   *
   * Note: R2/S3 keys live under `<uploadPath>/<key>`, but the bucket
   * name is NOT part of the URL path — the bucket is selected via the
   * `Host:` header. Putting it in the path produces a 404.
   */
  async getSignedUrl(options: {
    key: string;
    bucket?: string;
    expiresInSeconds?: number;
  }): Promise<string> {
    const uploadPath = this.getUploadPath();
    const baseUrl = `${this.getEndpoint()}/${uploadPath}/${options.key}`;
    const { AwsClient } = await import('aws4fetch');
    const client = new AwsClient({
      accessKeyId: this.configs.accessKeyId,
      secretAccessKey: this.configs.secretAccessKey,
      region: this.configs.region || 'auto',
    });
    const expires = options.expiresInSeconds ?? 7 * 24 * 60 * 60;
    const signed = await client.sign(new Request(baseUrl, { method: 'GET' }), {
      aws: { signQuery: true, appendSessionToken: false },
    });
    // aws4fetch sets expires via aws option; if not, manually append.
    const url = new URL(signed.url);
    if (!url.searchParams.has('X-Amz-Expires')) {
      url.searchParams.set('X-Amz-Expires', String(expires));
    }
    return url.toString();
  }

  exists = async (options: { key: string; bucket?: string }) => {
    try {
      const uploadBucket = options.bucket || this.configs.bucket;
      if (!uploadBucket) return false;
      const uploadPath = this.getUploadPath();
      const url = `${this.getEndpoint()}/${uploadBucket}/${uploadPath}/${options.key}`;

      const { AwsClient } = await import('aws4fetch');
      const client = new AwsClient({
        accessKeyId: this.configs.accessKeyId,
        secretAccessKey: this.configs.secretAccessKey,
        region: this.configs.region || 'auto',
      });

      const response = await client.fetch(
        new Request(url, {
          method: 'HEAD',
        })
      );

      return response.ok;
    } catch {
      return false;
    }
  };

  async uploadFile(
    options: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    try {
      const uploadBucket = options.bucket || this.configs.bucket;
      if (!uploadBucket) {
        return {
          success: false,
          error: 'Bucket is required',
          provider: this.name,
        };
      }

      const bodyArray =
        options.body instanceof Buffer
          ? new Uint8Array(options.body)
          : options.body;

      const uploadPath = this.getUploadPath();

      // R2 endpoint format: https://<accountId>.r2.cloudflarestorage.com
      // Use custom endpoint if provided, otherwise use default
      const url = `${this.getEndpoint()}/${uploadBucket}/${uploadPath}/${options.key}`;

      const { AwsClient } = await import('aws4fetch');

      // R2 uses "auto" as region for S3 API compatibility
      const client = new AwsClient({
        accessKeyId: this.configs.accessKeyId,
        secretAccessKey: this.configs.secretAccessKey,
        region: this.configs.region || 'auto',
      });

      const headers: Record<string, string> = {
        'Content-Type': options.contentType || 'application/octet-stream',
        'Content-Disposition': options.disposition || 'inline',
        'Content-Length': bodyArray.length.toString(),
      };

      const request = new Request(url, {
        method: 'PUT',
        headers,
        body: bodyArray as any,
      });

      const response = await client.fetch(request);

      if (!response.ok) {
        return {
          success: false,
          error: `Upload failed: ${response.statusText}`,
          provider: this.name,
        };
      }

      const publicUrl =
        this.getPublicUrl({ key: options.key, bucket: uploadBucket }) || url;

      return {
        success: true,
        location: url,
        bucket: uploadBucket,
        uploadPath: uploadPath,
        key: options.key,
        filename: options.key.split('/').pop(),
        url: publicUrl,
        provider: this.name,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: this.name,
      };
    }
  }

  /**
   * Authenticated download — signs a GET against the R2 S3 endpoint with the
   * provider's credentials. Returns the bytes (and best-effort MIME from the
   * response Content-Type header) so callers can hand them straight to a
   * parser without exposing the raw URL.
   *
   * Required because private R2 buckets return 401 on unauthenticated GET,
   * which is the normal case for user-uploaded attachments.
   */
  downloadFile = async (options: {
    key: string;
    bucket?: string;
  }): Promise<{ bytes: Buffer; mime: string }> => {
    const uploadBucket = options.bucket || this.configs.bucket;
    const uploadPath = this.getUploadPath();
    const url = `${this.getEndpoint()}/${uploadBucket}/${uploadPath}/${options.key}`;

    const { AwsClient } = await import('aws4fetch');
    const client = new AwsClient({
      accessKeyId: this.configs.accessKeyId,
      secretAccessKey: this.configs.secretAccessKey,
      region: this.configs.region || 'auto',
    });

    const res = await client.fetch(new Request(url, { method: 'GET' }));
    if (!res.ok) {
      throw new Error(`R2 GET failed: ${res.status} ${res.statusText}`);
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const mime =
      res.headers.get('content-type')?.split(';')[0] ||
      'application/octet-stream';
    return { bytes, mime };
  };

  async downloadAndUpload(
    options: StorageDownloadUploadOptions
  ): Promise<StorageUploadResult> {
    try {
      const response = await fetch(options.url);
      if (!response.ok) {
        return {
          success: false,
          error: `HTTP error! status: ${response.status}`,
          provider: this.name,
        };
      }

      if (!response.body) {
        return {
          success: false,
          error: 'No body in response',
          provider: this.name,
        };
      }

      const arrayBuffer = await response.arrayBuffer();
      const body = new Uint8Array(arrayBuffer);

      return this.uploadFile({
        body,
        key: options.key,
        bucket: options.bucket,
        contentType: options.contentType,
        disposition: options.disposition,
      });
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        provider: this.name,
      };
    }
  }
}

/**
 * Create R2 provider with configs
 */
export function createR2Provider(configs: R2Configs): R2Provider {
  return new R2Provider(configs);
}
