import { readFileSync } from 'fs';
const url = process.env.DIRECT_URL;
if (!url) throw new Error('DIRECT_URL not set');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient({ datasources: { db: { url } } });
const sql = readFileSync('/tmp/update-tpls.sql', 'utf8');
const stmts = sql.split('\n').filter(l => l.trim().startsWith('UPDATE'));
let n = 0;
for (const s of stmts) {
  const r = await prisma.$executeRawUnsafe(s);
  n++;
  console.log(`[${n}] rows=${r}`);
}
console.log('done, statements:', n);
await prisma.$disconnect();
