import {
  generateFileArtifact,
  type FileStudioKind,
  type FileStudioModelConfig,
  type FileStudioTemplate,
} from '@/core/file-generation';

export type {
  FileStudioArtifact,
  FileStudioKind,
  FileStudioTemplate,
} from '@/core/file-generation';

/**
 * Business boundary for the chat-style office-file creator. It deliberately
 * owns no database rows: the artifact is returned to the requesting user as a
 * downloadable result, just like a chat attachment.
 */
export async function generate(params: {
  kind: FileStudioKind;
  prompt: string;
  template?: FileStudioTemplate;
  model?: FileStudioModelConfig | null;
}) {
  return generateFileArtifact(params);
}
