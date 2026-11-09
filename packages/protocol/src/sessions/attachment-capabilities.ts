/** Parser identifiers describe supported document content, without selecting a host implementation. */
export type AttachmentDocumentFormat =
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'odt'
  | 'ods'
  | 'odp'
  | 'rtf'
  | 'epub';

export type AttachmentFormat = {
  readonly extensions: readonly string[];
  readonly mediaType: string;
  readonly aliases?: readonly string[];
} & (
  | { readonly kind: 'text' | 'image' | 'pdf' }
  | { readonly kind: 'document'; readonly parser: AttachmentDocumentFormat }
);

/** Upload byte limits shared by client preflight, host decoding and public validation. */
export const ATTACHMENT_BYTE_LIMITS = {
  text: 256_000,
  image: 2_097_152,
  pdf: 8_388_608,
  document: 8_388_608,
} as const;

export const ATTACHMENT_MAX_BYTES = Math.max(...Object.values(ATTACHMENT_BYTE_LIMITS));
export const ATTACHMENT_MAX_BASE64_LENGTH = 4 * Math.ceil(ATTACHMENT_MAX_BYTES / 3);
export const ATTACHMENT_IMAGE_BASE64_LENGTH = 4 * Math.ceil(ATTACHMENT_BYTE_LIMITS.image / 3);

/** Supported declarations are hints; the host still verifies MIME, signatures and decoded contents. */
export const ATTACHMENT_FORMATS: readonly AttachmentFormat[] = [
  {
    extensions: ['txt', 'ts', 'tsx', 'js', 'jsx', 'py', 'yml', 'yaml', 'css', 'html'],
    mediaType: 'text/plain',
    kind: 'text',
  },
  { extensions: ['md'], mediaType: 'text/markdown', kind: 'text' },
  { extensions: ['json'], mediaType: 'application/json', kind: 'text' },
  { extensions: ['csv'], mediaType: 'text/csv', kind: 'text' },
  { extensions: [], mediaType: 'application/xml', kind: 'text' },
  { extensions: [], mediaType: 'application/javascript', kind: 'text' },
  { extensions: [], mediaType: 'application/x-yaml', kind: 'text' },
  { extensions: ['png'], mediaType: 'image/png', kind: 'image' },
  { extensions: ['jpg', 'jpeg'], mediaType: 'image/jpeg', kind: 'image' },
  { extensions: ['gif'], mediaType: 'image/gif', kind: 'image' },
  { extensions: ['webp'], mediaType: 'image/webp', kind: 'image' },
  { extensions: ['pdf'], mediaType: 'application/pdf', kind: 'pdf' },
  {
    extensions: ['docx'],
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    kind: 'document',
    parser: 'docx',
  },
  {
    extensions: ['docm'],
    mediaType: 'application/vnd.ms-word.document.macroEnabled.12',
    kind: 'document',
    parser: 'docx',
  },
  {
    extensions: ['xlsx'],
    mediaType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    kind: 'document',
    parser: 'xlsx',
  },
  {
    extensions: ['xlsm'],
    mediaType: 'application/vnd.ms-excel.sheet.macroEnabled.12',
    kind: 'document',
    parser: 'xlsx',
  },
  {
    extensions: ['pptx'],
    mediaType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    kind: 'document',
    parser: 'pptx',
  },
  {
    extensions: ['pptm'],
    mediaType: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
    kind: 'document',
    parser: 'pptx',
  },
  {
    extensions: ['odt'],
    mediaType: 'application/vnd.oasis.opendocument.text',
    kind: 'document',
    parser: 'odt',
  },
  {
    extensions: ['ods'],
    mediaType: 'application/vnd.oasis.opendocument.spreadsheet',
    kind: 'document',
    parser: 'ods',
  },
  {
    extensions: ['odp'],
    mediaType: 'application/vnd.oasis.opendocument.presentation',
    kind: 'document',
    parser: 'odp',
  },
  {
    extensions: ['rtf'],
    mediaType: 'application/rtf',
    aliases: ['text/rtf'],
    kind: 'document',
    parser: 'rtf',
  },
  { extensions: ['epub'], mediaType: 'application/epub+zip', kind: 'document', parser: 'epub' },
];
