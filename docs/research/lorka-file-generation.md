# Lorka: three office-file generators

Scope deliberately excludes the rest of Lorka. This note covers only the
Create menu items shown in the supplied reference: presentation, document,
and spreadsheet.

## Evidence from the public client bundle

- Tool identifiers: `generate_pptx`, `generate_docx`, `generate_xlsx`.
- The picker is shown only when the selected chat model declares
  `capabilities.tools === true`.
- Selecting an item stores the identifier as `activeTool`, closes the popover,
  and sends it with the next chat message as `metadata.tools: [activeTool]`.
- Once selected, the compact Create button changes into the selected tool and
  clicking it again clears the tool.
- While a tool call is `input-streaming` or `input-available`, the message
  renders a spinner and a shimmer activity label. An `output-error` renders an
  error marker. An `output-available` call renders a completed marker plus the
  returned file attachment.
- Output attachments are typed by MIME. PPTX opens a dedicated modal viewer
  with previous/next slide controls and a current-slide selector. The client
  lazy-loads a `PptxViewer`, fetches the attachment bytes, and renders a
  windowed list of slides. PDF has its own viewer; DOCX and XLSX are normal
  downloadable/openable attachments rather than in-app editors.

## Interaction model

1. User writes a normal chat prompt.
2. User opens **Create** and selects exactly one output kind.
3. The next Submit attaches the chosen tool id to the chat turn.
4. The server/model invokes a matching generator tool.
5. The chat stream displays progress, then a typed file attachment.
6. The user previews (PPTX) or downloads/opens (DOCX/XLSX) the editable file.
7. A tool remains active until the user clears it or selects another one.

## Reproduction decision

Use the already configured Evolink OpenAI-compatible chat API with its default
`kimi-k3` model. It produces a constrained JSON plan, never Office XML or
binary directly. The server then owns file rendering:

| Selected tool   | Model output                   | Renderer                            | Result           |
| --------------- | ------------------------------ | ----------------------------------- | ---------------- |
| `generate_pptx` | title + slide/bullet plan      | `pptxgenjs`                         | editable `.pptx` |
| `generate_docx` | title + section/paragraph plan | minimal OOXML packaged with `jszip` | editable `.docx` |
| `generate_xlsx` | columns + typed rows           | `xlsx` (SheetJS)                    | editable `.xlsx` |

This separation avoids malformed Office files, limits model output to a
validated schema, and allows a local draft fallback when a provider is not yet
configured.

## Intentional scope boundary

No Lorka image, video, search, history, unrelated chat tools, or in-app DOCX /
XLSX editor is included. The product surface is only the three Create actions,
their generation state, preview, and download.
