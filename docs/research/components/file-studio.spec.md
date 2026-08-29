# FileStudio specification

## Overview

- **Target:** `src/blocks/file-studio.tsx`
- **Interaction model:** click-to-select tool, submit-to-generate, async result
- **Reference:** supplied Create popover screenshot and public Lorka client
  bundle.

## Menu states

- The trigger reads **Create** with a sparkle icon.
- Opening it shows a dark, rounded menu with exactly three rows:
  presentation, document, spreadsheet.
- Each row has a 24px outline icon and a text label. Selecting a row closes
  the menu and gives it a green confirmation mark.
- The current tool name remains beside the submit control.

## Generation states

- First stage: structure plan.
- Second stage: content writing.
- Third stage: Office file rendering.
- Completed state is a typed attachment card with create-again and download
  actions.

## Output handling

- PPTX: local slide preview with selectable thumbnails; download stays an
  editable native PPTX.
- DOCX: paper-like text preview; download stays an editable DOCX.
- XLSX: grid preview; download stays an editable XLSX.

## API contract

`POST /api/file-studio/generate`

```json
{ "kind": "pptx | docx | xlsx", "prompt": "user brief" }
```

The successful `respData` payload contains the filename, MIME type, base64
attachment bytes, model/draft mode, and a display-only preview model.
