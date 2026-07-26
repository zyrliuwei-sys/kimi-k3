export const SEEDANCE_VIDEO_MODEL = 'seedance-2.0-text-to-video';
const DEFAULT_BASE_URL = 'https://api.evolink.ai/v1';

export type SeedanceVideoQuality = '480p' | '720p' | '1080p' | '4k';
export type SeedanceVideoAspectRatio =
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:3'
  | '3:4'
  | '21:9'
  | 'adaptive';

export interface EvolinkVideoConfigs {
  apiKey: string;
  baseUrl?: string;
}

export interface SeedanceVideoOptions {
  prompt: string;
  duration: number;
  quality: SeedanceVideoQuality;
  aspectRatio: SeedanceVideoAspectRatio;
  generateAudio: boolean;
}

export type EvolinkVideoPollResult =
  | { status: 'pending' | 'processing'; progress?: number; raw: any }
  | {
      status: 'success';
      videoUrl: string;
      progress?: number;
      raw: any;
    }
  | { status: 'failed'; message: string; raw: any };

const SUCCESS_STATUSES = new Set([
  'success',
  'succeeded',
  'completed',
  'complete',
  'finished',
  'done',
  'ready',
  'output_ready',
  'video_ready',
]);

const FAILED_STATUSES = new Set([
  'failed',
  'error',
  'failure',
  'canceled',
  'cancelled',
]);

/**
 * EvoLink's Seedance endpoint is asynchronous and uses the same API key and
 * base URL as the Kimi chat/image endpoints. Keep this provider independent
 * from the Fal provider because the request and result contracts differ.
 */
export class EvolinkVideoProvider {
  readonly name = 'evolink-video';

  constructor(private readonly configs: EvolinkVideoConfigs) {}

  private get baseUrl() {
    return (this.configs.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private get apiKey() {
    if (!this.configs.apiKey) throw new Error('EvoLink API key is required');
    return this.configs.apiKey;
  }

  async submit(
    options: SeedanceVideoOptions
  ): Promise<{ taskId: string; model: string; raw: any }> {
    const response = await fetch(`${this.baseUrl}/videos/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: SEEDANCE_VIDEO_MODEL,
        prompt: options.prompt,
        duration: options.duration,
        quality: options.quality,
        aspect_ratio: options.aspectRatio,
        generate_audio: options.generateAudio,
        // Keep filtering enabled in the first version. The provider charges
        // extra for relaxed filtering and prohibited content remains blocked.
        content_filter: true,
        model_params: { web_search: false },
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(this.formatProviderError('submit', response, data));
    }

    const taskId = typeof data?.id === 'string' ? data.id : '';
    if (!taskId) {
      throw new Error(
        `EvoLink submit did not return a task id: ${JSON.stringify(data).slice(0, 500)}`
      );
    }

    return {
      taskId,
      model: data?.model || SEEDANCE_VIDEO_MODEL,
      raw: data,
    };
  }

  async queryStatus(taskId: string): Promise<EvolinkVideoPollResult> {
    if (!taskId) {
      return {
        status: 'failed',
        message: 'EvoLink task id is missing',
        raw: {},
      };
    }

    const response = await fetch(
      `${this.baseUrl}/videos/generations/${encodeURIComponent(taskId)}`,
      { headers: { Authorization: `Bearer ${this.apiKey}` } }
    );
    const data = await response.json().catch(() => ({}));

    // A 404 generally means the task cannot be found or the configured API
    // path is wrong. Mark it failed so credits are not held forever. Retry
    // transient provider failures on the next client poll instead.
    if (response.status === 404) {
      return {
        status: 'failed',
        message: this.formatProviderError('query', response, data),
        raw: data,
      };
    }
    if (!response.ok) {
      return { status: 'processing', raw: data };
    }

    const status = String(
      data?.status ??
        data?.state ??
        data?.task_status ??
        data?.taskState ??
        data?.phase ??
        ''
    ).toLowerCase();
    const progress = this.readProgress(data);

    if (FAILED_STATUSES.has(status)) {
      return {
        status: 'failed',
        message:
          data?.error?.message ||
          data?.error_message ||
          data?.message ||
          'Video task failed',
        raw: data,
      };
    }

    const videoUrl = this.extractVideoUrl(data);
    if (SUCCESS_STATUSES.has(status) && videoUrl) {
      return { status: 'success', videoUrl, progress, raw: data };
    }

    // Some task APIs return the output URL before updating their status. This
    // is safe to treat as success because the URL is the terminal artifact.
    if (videoUrl && this.looksTerminal(data)) {
      return { status: 'success', videoUrl, progress, raw: data };
    }

    return {
      status: status === 'pending' ? 'pending' : 'processing',
      progress,
      raw: data,
    };
  }

  private looksTerminal(data: any) {
    const status = String(data?.status ?? data?.state ?? '').toLowerCase();
    return (
      SUCCESS_STATUSES.has(status) ||
      Boolean(data?.completed_at || data?.completedAt)
    );
  }

  private readProgress(data: any): number | undefined {
    const value = Number(data?.progress ?? data?.percentage ?? data?.percent);
    return Number.isFinite(value) ? value : undefined;
  }

  private extractVideoUrl(data: any): string | undefined {
    const directKeys = [
      'video_url',
      'videoUrl',
      'url',
      'output_url',
      'outputUrl',
      'download_url',
      'downloadUrl',
      'result_url',
      'resultUrl',
    ];
    for (const key of directKeys) {
      if (typeof data?.[key] === 'string' && data[key]) return data[key];
    }

    const candidates = [
      data?.video,
      data?.videos,
      data?.output,
      data?.outputs,
      data?.result,
      data?.results,
      data?.data,
    ];
    for (const candidate of candidates) {
      const items = Array.isArray(candidate) ? candidate : [candidate];
      for (const item of items) {
        if (typeof item === 'string' && item) return item;
        for (const key of directKeys) {
          if (typeof item?.[key] === 'string' && item[key]) return item[key];
        }
      }
    }

    return undefined;
  }

  private formatProviderError(
    operation: string,
    response: Response,
    data: any
  ) {
    const detail =
      data?.error?.message ||
      data?.error_message ||
      data?.message ||
      response.statusText;
    return `EvoLink ${operation} failed: ${response.status} ${detail}`;
  }
}
