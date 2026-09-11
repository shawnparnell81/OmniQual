import 'dotenv/config'
import cookieParser from 'cookie-parser'
import express from 'express'
import { getDb, getDriverLabel } from './db/client.ts'
import { api } from './routes.ts'
import { seedIfEmpty } from './seed.ts'

const port = Number(process.env.PORT ?? 3001)

await getDb()
await seedIfEmpty()

const app = express()
app.disable('x-powered-by')
app.use(cookieParser())
app.use(express.json({ limit: '2mb' }))
app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: 'Invalid JSON.' })
    return
  }
  next(err)
})
app.use('/api', api)

app.listen(port, () => {
  console.log(`[omniqual] API on http://127.0.0.1:${port} (${getDriverLabel()})`)
})
