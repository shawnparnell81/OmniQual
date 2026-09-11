import 'dotenv/config'
import { applySqlMigration, getDriverLabel, getDb } from './client.ts'

await getDb()
await applySqlMigration()
console.log(`[omniqual] schema applied (${getDriverLabel()})`)
