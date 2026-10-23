import { supabase } from './client.js'
import { currentCircleId } from './currentCircle.js'

const BUCKETS = ['employees', 'deliverables', 'payslips', 'avatars']

// `employees`, `payslips` and `deliverables` hold company and personal data and are private, so
// their objects can only be reached through a short-lived signed URL.
// `avatars` is public so directory cards can load a stable photo URL.
const PRIVATE_BUCKETS = new Set(['employees', 'payslips', 'deliverables'])

const SIGNED_URL_TTL_SECONDS = 60 * 60

function bucketAndPath(fullPath) {
  const clean = String(fullPath).replace(/^\/+/, '')
  const [bucket, ...rest] = clean.split('/')
  if (BUCKETS.includes(bucket) && rest.length) {
    return { bucket, path: rest.join('/') }
  }
  return { bucket: 'employees', path: clean }
}

// Every object lives under its company folder: "<bucket>/<orgId>/<rest>". Callers keep storing the
// short path ("employees/<uid>/..."); the company folder is added here from the signed-in session
// so the database policies (which require folder 1 to be the caller's company) can match.
async function objectPath(storageRef) {
  const orgId = await currentCircleId()
  if (!orgId) throw new Error('You are not signed in to a company.')
  const path = String(storageRef.path || '').replace(/^\/+/, '')
  if (path.startsWith(`${orgId}/`)) return path
  return `${orgId}/${path}`
}

export function ref(_storage, fullPath) {
  return { fullPath, ...bucketAndPath(fullPath) }
}

export function uploadBytesResumable(storageRef, file) {
  const listeners = { progress: null, error: null, complete: null }
  const task = {
    snapshot: { bytesTransferred: 0, totalBytes: file.size || 1, ref: storageRef },
    on(_event, progress, error, complete) {
      listeners.progress = progress
      listeners.error = error
      listeners.complete = complete
      run()
    },
  }

  async function run() {
    try {
      if (!supabase) throw new Error('Supabase is not configured')
      listeners.progress?.({ bytesTransferred: 0, totalBytes: file.size || 1 })
      const path = await objectPath(storageRef)
      const { error } = await supabase.storage.from(storageRef.bucket).upload(path, file, {
        upsert: true,
        contentType: file.type || undefined,
      })
      if (error) throw error
      task.snapshot.bytesTransferred = file.size || 1
      listeners.progress?.(task.snapshot)
      await listeners.complete?.()
    } catch (err) {
      listeners.error?.(err)
    }
  }

  return task
}

export async function getDownloadURL(storageRef) {
  const path = await objectPath(storageRef)
  if (PRIVATE_BUCKETS.has(storageRef.bucket)) {
    const { data, error } = await supabase.storage
      .from(storageRef.bucket)
      .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
    if (error) throw error
    return data.signedUrl
  }
  const { data } = supabase.storage.from(storageRef.bucket).getPublicUrl(path)
  return data.publicUrl
}

/**
 * Resolve a fresh URL for a stored `storagePath` at the moment of use.
 * Signed URLs expire, and rows written while the buckets were public still
 * carry a stale public URL, so viewers must re-resolve instead of trusting
 * the persisted `downloadURL`.
 */
export async function resolveFileUrl(fullPath) {
  if (!fullPath || !supabase) return null
  return getDownloadURL(ref(null, fullPath))
}

export async function deleteObject(storageRef) {
  const path = await objectPath(storageRef)
  const { error } = await supabase.storage.from(storageRef.bucket).remove([path])
  if (error) throw error
}
