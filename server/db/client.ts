import 'dotenv/config'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite'
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { schema } from './schema.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dataDir = resolve(__dirname, '../../data/omniqual')

export type AppDb = NodePgDatabase<typeof schema> | PgliteDatabase<typeof schema>

let dbPromise: Promise<AppDb> | null = null
let driverLabel = 'pglite'
let pool: pg.Pool | null = null
let pglite: PGlite | null = null

export function getDriverLabel() {
  return driverLabel
}

export async function getDb(): Promise<AppDb> {
  if (!dbPromise) {
    dbPromise = connect()
  }
  return dbPromise
}

async function connect(): Promise<AppDb> {
  const url = process.env.DATABASE_URL?.trim()
  if (url) {
    pool = new pg.Pool({ connectionString: url })
    await pool.query('SELECT 1')
    driverLabel = 'postgresql'
    console.log('[omniqual] connected to PostgreSQL via DATABASE_URL')
    return drizzlePg(pool, { schema })
  }

  mkdirSync(dataDir, { recursive: true })
  pglite = new PGlite(dataDir)
  await pglite.query('SELECT 1')
  driverLabel = 'pglite'
  console.log(`[omniqual] using file-backed PGlite at ${dataDir}`)
  return drizzlePglite(pglite, { schema })
}

async function runSql(sql: string) {
  if (pool) {
    await pool.query(sql)
    return
  }
  if (pglite) {
    await pglite.exec(sql)
  }
}

async function hasOrganizationsTable() {
  const check = `
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'organizations'
    ) AS present;
  `
  if (pool) {
    const result = await pool.query<{ present: boolean }>(check)
    return Boolean(result.rows[0]?.present)
  }
  if (pglite) {
    const result = await pglite.query<{ present: boolean }>(check)
    return Boolean(result.rows[0]?.present)
  }
  return false
}

export async function applySqlMigration() {
  await getDb()
  const hasOrgs = await hasOrganizationsTable()
  if (!hasOrgs) {
    await runSql(`
      DROP TABLE IF EXISTS audit_events CASCADE;
      DROP TABLE IF EXISTS form_records CASCADE;
      DROP TABLE IF EXISTS form_templates CASCADE;
      DROP TABLE IF EXISTS sessions CASCADE;
      DROP TABLE IF EXISTS folders CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
    `)
  }
  const migrationsDir = resolve(__dirname, './migrations')
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()
  for (const file of files) {
    await runSql(readFileSync(resolve(migrationsDir, file), 'utf8'))
  }
}
