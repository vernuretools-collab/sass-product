import {
  collection,
  doc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../../../shared/services/firebaseService'
import { currentCircleId } from '../../../../shared/supabase/currentCircle.js'

/**
 * Fetch all registered client accounts from Firestore /users where role == 'client'
 */
export const getClientsFromDb = async () => {
  try {
    const orgId = await currentCircleId()
    if (!orgId) return []
    const usersRef = collection(db, 'users')
    const q = query(usersRef, where('role', '==', 'client'), where('orgId', '==', orgId))
    const snap = await getDocs(q)
    return snap.docs.map((docSnap) => ({
      clientId: docSnap.id,
      uid: docSnap.id,
      ...docSnap.data(),
    }))
  } catch (err) {
    console.error('Error fetching client accounts from Firestore:', err)
    return []
  }
}

/**
 * Update client profile details in Firestore /users/{uid}
 */
export const updateClientInDb = async (uid, data) => {
  try {
    const userRef = doc(db, 'users', uid)
    await updateDoc(userRef, {
      ...data,
      updatedAt: new Date().toISOString(),
    })
    return true
  } catch (err) {
    console.error('Error updating client in Firestore:', err)
    return false
  }
}

/**
 * Delete a client user profile from Firestore /users/{uid}
 */
export const deleteClientFromDb = async (uid) => {
  try {
    const userRef = doc(db, 'users', uid)
    await deleteDoc(userRef)
    return true
  } catch (err) {
    console.error('Error deleting client from Firestore:', err)
    return false
  }
}
