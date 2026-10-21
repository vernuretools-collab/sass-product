import {
  collection,
  doc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
} from 'firebase/firestore'
import { db } from '../../../shared/services/firebaseService'
import { currentCircleId } from '../../../../../shared/supabase/currentCircle.js'

/**
 * Fetch custom CRM pipeline stages from Firestore
 */
export const getCrmStagesFromDb = async () => {
  try {
    const snap = await getDocs(collection(db, 'crmStages'))
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (err) {
    console.error('Error fetching CRM stages from Firestore:', err)
    return []
  }
}

/**
 * Save custom CRM stage to Firestore
 */
export const createCrmStageInDb = async (stageData) => {
  try {
    const docRef = doc(db, 'crmStages', stageData.id)
    await setDoc(docRef, stageData)
    return stageData
  } catch (err) {
    console.error('Error creating CRM stage in Firestore:', err)
    return stageData
  }
}

/**
 * Fetch all leads from Firestore
 */
export const getLeads = async () => {
  try {
    const orgId = await currentCircleId()
    if (!orgId) return []
    const leadsRef = collection(db, 'leads')
    const q = query(leadsRef, where('orgId', '==', orgId))
    const snap = await getDocs(q)
    return snap.docs
      .map((docSnap) => ({ leadId: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
  } catch (err) {
    console.error('Error fetching leads from Firestore:', err)
    return []
  }
}

/**
 * Create a new lead document in Firestore
 */
export const createLead = async (_orgId, leadData) => {
  const orgId = await currentCircleId()
  if (!orgId) throw new Error('Sign in to a company circle before adding leads.')
  try {
    const leadsRef = collection(db, 'leads')
    const docRef = await addDoc(leadsRef, {
      ...leadData,
      orgId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    return { leadId: docRef.id, orgId, ...leadData }
  } catch (err) {
    console.error('Error creating lead in Firestore:', err)
    throw err
  }
}

/**
 * Update lead pipeline stage in Firestore
 */
export const updateLeadStageInDb = async (orgId, leadId, stageId, stageName) => {
  try {
    if (!leadId) return
    const leadRef = doc(db, 'leads', leadId)
    await updateDoc(leadRef, {
      pipelineStageId: stageId,
      pipelineStage: stageName,
      updatedAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('Error updating lead stage in Firestore:', err)
  }
}

/**
 * Delete a lead from Firestore
 */
export const deleteLeadFromDb = async (orgId, leadId) => {
  try {
    if (!leadId) return
    const leadRef = doc(db, 'leads', leadId)
    await deleteDoc(leadRef)
  } catch (err) {
    console.error('Error deleting lead from Firestore:', err)
  }
}
