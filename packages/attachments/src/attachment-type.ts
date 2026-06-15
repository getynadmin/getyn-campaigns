/**
 * Mirror of Prisma's `AttachmentType` enum, redeclared here so the
 * package doesn't pull `@getyn/db` (which would drag the Prisma client
 * into the worker AND web bundles for what is otherwise plain code).
 */
export type AttachmentType = 'IMAGE' | 'PDF' | 'SPREADSHEET' | 'DOCUMENT';
