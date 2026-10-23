import { db, storage } from '../../../shared/services/firebaseService'
import { setDoc, doc, getDoc, collection, query, where, getDocs, limit } from 'firebase/firestore'
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'

export const PROFILE_PHOTO_MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif'])

export function profilePhotoStoragePath(uid) {
  return `avatars/${uid}/avatar`
}

async function uploadToPath(storagePath, file) {
  const storageRef = ref(storage, storagePath)
  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef, file)
    task.on('state_changed', null, reject, resolve)
  })
  const publicUrl = await getDownloadURL(storageRef)
  return { photoURL: cacheBustUrl(publicUrl), storagePath }
}

export function cacheBustUrl(url) {
  if (!url) return ''
  const join = url.includes('?') ? '&' : '?'
  return `${url}${join}t=${Date.now()}`
}

export async function mergeEmployeeFields(uid, email, fields) {
  const empRef = doc(db, 'employees', uid)
  const empSnap = await getDoc(empRef)
  if (empSnap.exists()) {
    await setDoc(empRef, fields, { merge: true })
    return
  }
  if (!email) return
  const empQuery = query(collection(db, 'employees'), where('email', '==', email), limit(1))
  const empByEmail = await getDocs(empQuery)
  if (!empByEmail.empty) {
    await setDoc(empByEmail.docs[0].ref, fields, { merge: true })
  }
}

export async function uploadProfilePhoto(uid, file) {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error('Use a JPEG, PNG, WebP, or GIF image.')
  }
  if (file.size > PROFILE_PHOTO_MAX_BYTES) {
    throw new Error('Photo must be 2 MB or smaller.')
  }

  return await uploadToPath(profilePhotoStoragePath(uid), file)
}

async function deleteAtPath(storagePath) {
  try {
    await deleteObject(ref(storage, storagePath))
  } catch (err) {
    if (err?.statusCode === 404 || err?.message?.includes('not found')) return
    throw err
  }
}

export async function deleteProfilePhoto(uid) {
  await deleteAtPath(profilePhotoStoragePath(uid))
}
