/**
 * Keep the employee directory as Firebase /employees only.
 * Dummy Auth / users-collection accounts stay in profiles, not employees.
 *
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY
 * Optional: GOOGLE_APPLICATION_CREDENTIALS / FIREBASE_PROJECT_ID (default new-crm-8165a)
 */
import { createClient } from '@supabase/supabase-js'
import { createRequire } from 'node:module'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, resolve, join } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
}

loadEnvFile(resolve(root, '.env'))
loadEnvFile(resolve(root, 'admin-portal/.env'))

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key || url === 'mock') {
  console.log('Skip repair: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.')
  process.exit(0)
}

function initFirebaseAdmin() {
  const admin = require('firebase-admin')
  if (admin.apps.length) return admin
  const projectId = process.env.FIREBASE_PROJECT_ID || 'new-crm-8165a'
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const cfgPath = join(homedir(), '.config', 'configstore', 'firebase-tools.json')
    if (existsSync(cfgPath)) {
      const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'))
      const refresh = cfg.tokens?.refresh_token
      if (refresh) {
        const adcPath = join(tmpdir(), 'new-crm-firebase-adc.json')
        // client_id/secret below are the public Firebase CLI OAuth client (shipped in firebase-tools),
        // not a secret of this project. The file holds the user's refresh token, so keep it private.
        writeFileSync(adcPath, JSON.stringify({
          type: 'authorized_user',
          client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',
          client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi',
          refresh_token: refresh,
        }), { mode: 0o600 })
        process.env.GOOGLE_APPLICATION_CREDENTIALS = adcPath
      }
    }
  }
  admin.initializeApp({ projectId })
  return admin
}

const fbAdmin = initFirebaseAdmin()
const empSnap = await fbAdmin.firestore().collection('employees').get()
const realIds = new Set(empSnap.docs.map((d) => d.id))
console.log(`Firebase /employees: ${realIds.size}`)

const sb = createClient(url, key, { auth: { persistSession: false } })
const { data: employees, error } = await sb.from('employees').select('id,org_id,data')
if (error) throw error

let removed = 0
let kept = 0
for (const e of employees || []) {
  if (realIds.has(e.id)) {
    kept += 1
    continue
  }
  const { error: delErr } = await sb.from('employees').delete().eq('id', e.id)
  if (delErr) console.warn('delete failed', e.id, delErr.message)
  else {
    removed += 1
    const name = e.data?.displayName || e.data?.name || e.data?.email || e.id
    console.log('removed dummy employee', name, e.id)
  }
}

console.log(`Employee directory repair: kept ${kept} real employees, removed ${removed} dummy rows.`)
