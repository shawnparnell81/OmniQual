import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import type { NextFunction, Request, Response } from 'express'
import type { SessionUser } from '../shared/types.ts'
import { getDb } from './db/client.ts'
import { organizations, sessions, users } from './db/schema.ts'
import { seedQmsForOrganization, slugify } from './seed.ts'

const COOKIE = 'oq_session'
const WEEK_MS = 7 * 24 * 60 * 60 * 1000

export type AuthedRequest = Request & { user?: SessionUser }

function toSessionUser(
  user: { id: string; email: string; name: string },
  org: { id: string; name: string; slug: string },
): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    organization: { id: org.id, name: org.name, slug: org.slug },
  }
}

async function createSession(userId: string) {
  const db = await getDb()
  const token = randomBytes(32).toString('hex')
  await db.insert(sessions).values({
    id: randomUUID(),
    userId,
    token,
    expiresAt: new Date(Date.now() + WEEK_MS),
  })
  return token
}

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: WEEK_MS,
    path: '/',
  })
}

export async function loginHandler(req: Request, res: Response) {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  if (!email || !password) {
    res.status(400).json({ error: 'Email and password are required.' })
    return
  }

  const db = await getDb()
  const [user] = await db.select().from(users).where(eq(users.email, email))
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid email or password.' })
    return
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId))
  if (!org) {
    res.status(401).json({ error: 'Organization not found.' })
    return
  }

  const token = await createSession(user.id)
  setSessionCookie(res, token)
  res.json({ user: toSessionUser(user, org) })
}

export async function registerHandler(req: Request, res: Response) {
  const email = String(req.body?.email ?? '').trim().toLowerCase()
  const password = String(req.body?.password ?? '')
  const name = String(req.body?.name ?? '').trim()
  const organizationName = String(req.body?.organizationName ?? '').trim()

  if (!email || !password || !name || !organizationName) {
    res.status(400).json({ error: 'Organization, name, email, and password are required.' })
    return
  }
  if (password.length < 4) {
    res.status(400).json({ error: 'Password is too short.' })
    return
  }

  const db = await getDb()
  const [existing] = await db.select().from(users).where(eq(users.email, email))
  if (existing) {
    res.status(409).json({ error: 'That email is already registered.' })
    return
  }

  let slug = slugify(organizationName)
  const [slugHit] = await db.select().from(organizations).where(eq(organizations.slug, slug))
  if (slugHit) slug = `${slug}-${randomBytes(3).toString('hex')}`

  const organizationId = randomUUID()
  const userId = randomUUID()
  const passwordHash = await bcrypt.hash(password, 10)

  await db.insert(organizations).values({ id: organizationId, name: organizationName, slug })
  await db.insert(users).values({
    id: userId,
    organizationId,
    email,
    name,
    passwordHash,
    department: 'Quality',
  })
  await seedQmsForOrganization(db, organizationId, userId)

  const token = await createSession(userId)
  setSessionCookie(res, token)
  res.status(201).json({
    user: toSessionUser(
      { id: userId, email, name },
      { id: organizationId, name: organizationName, slug },
    ),
  })
}

export async function logoutHandler(req: Request, res: Response) {
  const token = req.cookies?.[COOKIE] as string | undefined
  if (token) {
    const db = await getDb()
    await db.delete(sessions).where(eq(sessions.token, token))
  }
  res.clearCookie(COOKIE, { path: '/' })
  res.json({ ok: true })
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE] as string | undefined
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' })
    return
  }

  const db = await getDb()
  const [session] = await db.select().from(sessions).where(eq(sessions.token, token))
  if (!session || session.expiresAt.getTime() < Date.now()) {
    res.status(401).json({ error: 'Session expired.' })
    return
  }

  const [user] = await db.select().from(users).where(eq(users.id, session.userId))
  if (!user) {
    res.status(401).json({ error: 'Unknown user.' })
    return
  }

  const [org] = await db.select().from(organizations).where(eq(organizations.id, user.organizationId))
  if (!org) {
    res.status(401).json({ error: 'Organization not found.' })
    return
  }

  req.user = toSessionUser(user, org)
  next()
}

export async function meHandler(req: AuthedRequest, res: Response) {
  res.json({ user: req.user })
}
