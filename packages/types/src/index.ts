// Shared Zod schemas + inferred TypeScript types for Getyn Campaigns.
// Consumed by both the server (tRPC input validation) and the client
// (React Hook Form resolvers). Full schemas land with the tRPC chunk —
// this file is intentionally minimal in Phase 1's first pass.

export * from './common';
export * from './contacts';
export * from './imports';
export * from './queues';
export * from './segments';
export * from './suppression';
