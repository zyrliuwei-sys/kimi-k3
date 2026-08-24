import { createFileRoute } from '@tanstack/react-router';

import { DocumentLibrary } from '@/blocks/document-library';

function DocumentsPage() {
  return <DocumentLibrary />;
}

export const Route = createFileRoute('/settings/documents')({
  component: DocumentsPage,
});
