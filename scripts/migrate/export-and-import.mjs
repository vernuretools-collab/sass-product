/**
 * One-way Firebase Firestore/Storage -> Supabase import. Does not write to Firebase.
 *
 * Auth: uses GOOGLE_APPLICATION_CREDENTIALS if set, otherwise Firebase CLI
 * login tokens from ~/.config/configstore/firebase-tools.json (ADC / gcloud optional).
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * Flags: --skip-firestore --skip-auth --storage --auth --dry-run
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { createClient } from '@supabase/supabase-js'
import { resolveCollection } from '../../shared/supabase/pathMap.js'
import { loadMigrateEnv } from './loadEnv.mjs'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
loadMigrateEnv(ROOT)

// Public OAuth client of the Firebase CLI (firebase-tools ships these exact values in its source).
// Google treats installed-app client secrets as non-confidential; they only identify the CLI so the
// refresh token from `firebase login` (~/.config/configstore/firebase-tools.json) can be exchanged.
// This is not a credential of this project. Do not put any project-specific secret here.
const FIREBASE_CLI_OAUTH = {
  client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
  client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
}

function jsonSafe(value) {
  if (value == null) return value
  if (typeof value.toDate === 'function') {
    try {
      return { __ts: value.toDate().toISOString() }
    } catch {
      return String(value)
    }
  }
  if (typeof value.seconds === 'number' && value.nanoseconds != null) {
    return { __ts: new Date(value.seconds * 1000).toISOString() }
  }
  if (value._seconds != null) {
    return { __ts: new Date(value._seconds * 1000).toISOString() }
  }
  if (typeof value.path === 'string' && value.id) return value.path
  if (Array.isArray(value)) return value.map(jsonSafe)
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = jsonSafe(v)
    return out
  }
  return value
}

function row(id, data, loc) {
  const storageId = loc.user_id ? `${loc.user_id}__${id}` : id
  return {
    id: storageId,
    org_id: loc.org_id || data.orgId || null,
    user_id: loc.user_id || data.uid || data.employeeId || data.userId || null,
    parent_id: loc.parent_id || null,
    collection_name: loc.collection_name || null,
    auth_id: loc.auth_id || null,
    data: jsonSafe(data) || {},
    updated_at: new Date().toISOString(),
  }
}

async function upsert(supabase, table, records) {
  if (!records.length) return
  for (let i = 0; i < records.length; i += 200) {
    const chunk = records.slice(i, i + 200)
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: 'id' })
    if (error) throw new Error(`${table}: ${error.message}`)
    console.log(`upserted ${chunk.length} -> ${table}`)
  }
}

async function upsertProfilesPreserveAuth(supabase, records) {
  for (const rec of records) {
    const { data: existing, error: readErr } = await supabase
      .from('profiles')
      .select('auth_id,data')
      .eq('id', rec.id)
      .maybeSingle()
    if (readErr) throw readErr
    const merged = {
      ...rec,
      auth_id: existing?.auth_id || rec.auth_id || null,
      data: { ...(existing?.data || {}), ...rec.data },
    }
    const { error } = await supabase.from('profiles').upsert(merged, { onConflict: 'id' })
    if (error) throw error
  }
  console.log(`merged ${records.length} -> profiles (auth_id preserved)`)
}

const WALK_SUBCOLLECTIONS = new Set([
  'organizations',
  'projects',
  'documents',
  'payslips',
  'goals',
  'employeeGoals',
  'notifications',
])

async function walkCollection(colRef, pathParts, docs) {
  const snap = await colRef.get()
  const walkSubs = WALK_SUBCOLLECTIONS.has(pathParts[0])
  console.log(`  ${pathParts.join('/')} docs=${snap.size} walkSubs=${walkSubs}`)
  for (const docSnap of snap.docs) {
    const docPath = [...pathParts, docSnap.id]
    docs.push({ path: docPath, data: docSnap.data() || {} })
    if (!walkSubs) continue
    const subs = await docSnap.ref.listCollections()
    for (const sub of subs) {
      await walkCollection(sub, [...docPath, sub.id], docs)
    }
  }
}

async function dumpAllDocs(db) {
  const docs = []
  const roots = await db.listCollections()
  for (const col of roots) {
    console.log('scanning', col.id)
    await walkCollection(col, [col.id], docs)
  }
  return docs
}

function groupedByTable(docs) {
  const groups = new Map()
  for (const item of docs) {
    const id = item.path[item.path.length - 1]
    const colParts = item.path.slice(0, -1)
    const loc = resolveCollection(colParts)
    const rec = row(id, item.data, loc)
    if (!groups.has(loc.table)) groups.set(loc.table, [])
    groups.get(loc.table).push(rec)
  }
  return groups
}

function loadFirebaseCliCredential() {
  const cfgPath = path.join(os.homedir(), '.config', 'configstore', 'firebase-tools.json')
  if (!fs.existsSync(cfgPath)) return null
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
  const refresh = cfg.tokens?.refresh_token
  if (!refresh) return null
  return {
    type: 'authorized_user',
    client_id: FIREBASE_CLI_OAUTH.client_id,
    client_secret: FIREBASE_CLI_OAUTH.client_secret,
    refresh_token: refresh,
  }
}

function writeAdcFromFirebaseCli() {
  const refresh = loadFirebaseCliCredential()
  if (!refresh) return null
  const adcPath = path.join(os.tmpdir(), 'new-crm-firebase-adc.json')
  fs.writeFileSync(adcPath, JSON.stringify(refresh, null, 2), { mode: 0o600 })
  process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath
  return adcPath
}

function initAdmin() {
  const admin = require('firebase-admin')
  if (admin.apps.length) return admin
  const projectId = process.env.FIREBASE_PROJECT_ID || 'new-crm-8165a'
  const bucket =
    process.env.FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`
  const opts = { projectId, storageBucket: bucket }

  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const adc = writeAdcFromFirebaseCli()
    if (adc) console.log('firebase-admin: ADC from Firebase CLI login')
  }

  admin.initializeApp(opts)
  return admin
}

export { dumpAllDocs, groupedByTable, initAdmin, WALK_SUBCOLLECTIONS }

export async function countTable(supabase, table) {
  const { count, error } = await supabase.from(table).select('id', { count: 'exact', head: true })
  if (error) return { count: null, error: error.message }
  return { count: count ?? 0, error: null }
}

export async function countBucket(supabase, bucket) {
  let total = 0
  async function walk(prefix) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, { limit: 1000 })
    if (error) throw new Error(`${bucket}: ${error.message}`)
    for (const item of data || []) {
      if (item.id) total += 1
      else if (item.name) await walk(prefix ? `${prefix}/${item.name}` : item.name)
    }
  }
  try {
    await walk('')
    return { count: total, error: null }
  } catch (err) {
    return { count: null, error: err.message }
  }
}

export async function printInventory(docs, supabase, extra = {}) {
  const groups = groupedByTable(docs)
  const firebaseByTable = [...groups.entries()].map(([table, records]) => [table, records.length])
  firebaseByTable.sort((a, b) => a[0].localeCompare(b[0]))

  console.log('\n=== Firestore -> table mapping ===')
  console.log('table'.padEnd(28) + 'firebase'.padStart(10) + 'supabase'.padStart(10) + '  gap')
  for (const [table, fbCount] of firebaseByTable) {
    const sb = await countTable(supabase, table)
    const sbCount = sb.error ? `err:${sb.error}` : String(sb.count)
    const gap =
      sb.error || sb.count == null ? '?' : fbCount > sb.count ? `-${fbCount - sb.count}` : fbCount < sb.count ? `+${sb.count - fbCount}` : 'ok'
    console.log(table.padEnd(28) + String(fbCount).padStart(10) + String(sbCount).padStart(10) + `  ${gap}`)
  }

  const roots = extra.roots || []
  if (roots.length) {
    console.log('\n=== Firebase root collections ===')
    for (const r of roots) console.log(`  ${r.id} docs=${r.size}`)
  }

  if (extra.missedSubs?.length) {
    console.log('\n=== Subcollections on non-walked roots (would be missed) ===')
    for (const line of extra.missedSubs) console.log(' ', line)
  } else if (extra.missedSubs) {
    console.log('\n=== Subcollections on non-walked roots === none found')
  }

  console.log('\n=== Storage ===')
  if (extra.firebaseStorageCount != null) console.log(`  firebase objects: ${extra.firebaseStorageCount}`)
  for (const bucket of ['employees', 'deliverables', 'payslips']) {
    const sb = await countBucket(supabase, bucket)
    console.log(`  supabase ${bucket}: ${sb.error ? sb.error : sb.count}`)
  }
}

async function copyStorage(admin, supabase) {
  const bucket = admin.storage().bucket()
  const [files] = await bucket.getFiles({ prefix: '' })
  console.log(`storage objects: ${files.length}`)
  for (const file of files) {
    const dest = file.name
    if (!dest || dest.endsWith('/')) continue
    const [buf] = await file.download()
    const [bkt, ...rest] = dest.split('/')
    const bucketName = ['employees', 'deliverables', 'payslips'].includes(bkt) ? bkt : 'employees'
    const objectPath = ['employees', 'deliverables', 'payslips'].includes(bkt) ? rest.join('/') : dest
    const { error } = await supabase.storage.from(bucketName).upload(objectPath, buf, { upsert: true })
    if (error) console.warn('storage', dest, error.message)
    else console.log('uploaded', dest)
  }
}

export async function findMissedSubcollections(db) {
  const missed = []
  const roots = await db.listCollections()
  const rootMeta = []
  for (const col of roots) {
    const snap = await col.get()
    rootMeta.push({ id: col.id, size: snap.size })
    if (WALK_SUBCOLLECTIONS.has(col.id)) continue
    const sample = snap.docs.slice(0, 25)
    for (const docSnap of sample) {
      const subs = await docSnap.ref.listCollections()
      for (const sub of subs) {
        missed.push(`${col.id}/{${docSnap.id}}/${sub.id}`)
      }
    }
  }
  return { missed, roots: rootMeta }
}

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required')
  if (url.includes('127.0.0.1') || url.includes('localhost')) {
    console.warn('Warning: SUPABASE_URL looks local. Expected hosted project.')
  }

  const dryRun = process.argv.includes('--dry-run')
  const admin = initAdmin()
  const db = admin.firestore()
  const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })

  const extra = {}
  try {
    extra.firebaseStorageCount = (await admin.storage().bucket().getFiles({ prefix: '' }))[0].length
  } catch (err) {
    extra.firebaseStorageCount = `err: ${err.message}`
  }

  if (dryRun) {
    const missed = await findMissedSubcollections(db)
    extra.missedSubs = missed.missed
    extra.roots = missed.roots
    const docs = process.argv.includes('--skip-firestore') ? [] : await dumpAllDocs(db)
    console.log(`firestore docs: ${docs.length} (dry-run, no writes)`)
    await printInventory(docs, supabase, extra)
    console.log('\nDry run complete. Live Firebase data was not modified.')
    return
  }

  if (!process.argv.includes('--skip-firestore')) {
    const docs = await dumpAllDocs(db)
    console.log(`firestore docs: ${docs.length}`)
    const groups = groupedByTable(docs)
    for (const [table, records] of groups) {
      if (table === 'profiles') await upsertProfilesPreserveAuth(supabase, records)
      else await upsert(supabase, table, records)
    }
  }

  if (process.argv.includes('--auth')) {
    console.log('skipping --auth: use import-firebase-auth.mjs (scrypt passwords already imported)')
  }

  if (process.argv.includes('--storage')) {
    try {
      await copyStorage(admin, supabase)
    } catch (err) {
      console.warn('storage copy failed (data import already saved):', err.message || err)
    }
  }

  console.log('Migration pass complete. Live Firebase data was not modified.')
}

const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirect) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
