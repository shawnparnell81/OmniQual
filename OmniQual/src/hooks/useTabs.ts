import { useCallback, useEffect, useState } from 'react'
import type { LinkedItem } from '../../../shared/types.ts'

export type WorkspaceTab = {
  id: string
  kind:
    | 'folder'
    | 'form'
    | 'document'
    | 'audit'
    | 'training'
    | 'calibration'
    | 'supplier'
    | 'review'
    | 'discrepancy'
    | 'inspection'
  title: string
  folderId?: string
  recordId?: string
  documentId?: string
  auditId?: string
  trainingId?: string
  calibrationId?: string
  supplierId?: string
  reviewId?: string
  discrepancyId?: string
  inspectionId?: string
}

export function tabFromLinked(item: LinkedItem): WorkspaceTab | null {
  if (item.kind === 'ncr' || item.kind === 'capa' || item.kind === 'form' || item.recordId) {
    const recordId = item.recordId ?? item.id
    return {
      id: `form/${recordId}`,
      kind: 'form',
      title: item.title,
      recordId,
      folderId: item.folderId,
    }
  }
  if (item.kind === 'audit' || item.kind === 'finding') {
    const auditId = item.auditId ?? item.id
    return {
      id: `audit/${auditId}`,
      kind: 'audit',
      title: item.title,
      auditId,
      folderId: item.folderId,
    }
  }
  if (item.kind === 'discrepancy') {
    return {
      id: `discrepancy/${item.id}`,
      kind: 'discrepancy',
      title: item.title,
      discrepancyId: item.id,
      folderId: item.folderId,
    }
  }
  if (item.kind === 'calibration') {
    return {
      id: `calibration/${item.id}`,
      kind: 'calibration',
      title: item.title,
      calibrationId: item.id,
      folderId: item.folderId,
    }
  }
  if (item.kind === 'inspection') {
    return {
      id: `inspection/${item.id}`,
      kind: 'inspection',
      title: item.title,
      inspectionId: item.id,
      folderId: item.folderId,
    }
  }
  if (item.kind === 'supplier') {
    return {
      id: `supplier/${item.id}`,
      kind: 'supplier',
      title: item.title,
      supplierId: item.id,
      folderId: item.folderId,
    }
  }
  if (item.kind === 'review' || item.kind === 'management_review') {
    return {
      id: `review/${item.id}`,
      kind: 'review',
      title: item.title,
      reviewId: item.id,
      folderId: item.folderId,
    }
  }
  return null
}

type Persisted = {
  tabs: WorkspaceTab[]
  activeId: string | null
}

function storageKey(organizationId: string | undefined) {
  return organizationId
    ? `omniqual.workspace.tabs.${organizationId}`
    : 'omniqual.workspace.tabs'
}

function load(organizationId: string | undefined): Persisted {
  try {
    const raw = localStorage.getItem(storageKey(organizationId))
    if (!raw) return { tabs: [], activeId: null }
    const parsed = JSON.parse(raw) as Persisted
    if (!Array.isArray(parsed.tabs)) return { tabs: [], activeId: null }
    return parsed
  } catch {
    return { tabs: [], activeId: null }
  }
}

export function useTabs(organizationId: string | undefined) {
  const [{ tabs, activeId }, setState] = useState<Persisted>(() => load(organizationId))

  useEffect(() => {
    setState(load(organizationId))
  }, [organizationId])

  useEffect(() => {
    if (!organizationId) return
    localStorage.setItem(storageKey(organizationId), JSON.stringify({ tabs, activeId }))
  }, [tabs, activeId, organizationId])

  const openTab = useCallback((tab: WorkspaceTab) => {
    setState((current) => {
      const exists = current.tabs.some((item) => item.id === tab.id)
      return {
        tabs: exists
          ? current.tabs.map((item) => (item.id === tab.id ? { ...item, ...tab } : item))
          : [...current.tabs, tab],
        activeId: tab.id,
      }
    })
  }, [])

  const activate = useCallback((id: string) => {
    setState((current) => ({ ...current, activeId: id }))
  }, [])

  const closeTab = useCallback((id: string) => {
    setState((current) => {
      const index = current.tabs.findIndex((tab) => tab.id === id)
      const nextTabs = current.tabs.filter((tab) => tab.id !== id)
      let nextActive = current.activeId
      if (current.activeId === id) {
        const neighbor = nextTabs[index] ?? nextTabs[index - 1] ?? null
        nextActive = neighbor?.id ?? null
      }
      return { tabs: nextTabs, activeId: nextActive }
    })
  }, [])

  const closeActive = useCallback(() => {
    setState((current) => {
      if (!current.activeId) return current
      const index = current.tabs.findIndex((tab) => tab.id === current.activeId)
      const nextTabs = current.tabs.filter((tab) => tab.id !== current.activeId)
      const neighbor = nextTabs[index] ?? nextTabs[index - 1] ?? null
      return { tabs: nextTabs, activeId: neighbor?.id ?? null }
    })
  }, [])

  const cycle = useCallback((direction: 1 | -1) => {
    setState((current) => {
      if (current.tabs.length === 0) return current
      const index = Math.max(
        0,
        current.tabs.findIndex((tab) => tab.id === current.activeId),
      )
      const next = current.tabs[(index + direction + current.tabs.length) % current.tabs.length]
      return { ...current, activeId: next.id }
    })
  }, [])

  const renameTab = useCallback((id: string, title: string) => {
    setState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
    }))
  }, [])

  const reorder = useCallback((fromId: string, toId: string) => {
    setState((current) => {
      const from = current.tabs.findIndex((tab) => tab.id === fromId)
      const to = current.tabs.findIndex((tab) => tab.id === toId)
      if (from < 0 || to < 0 || from === to) return current
      const next = [...current.tabs]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...current, tabs: next }
    })
  }, [])

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? null

  return {
    tabs,
    activeId,
    activeTab,
    openTab,
    activate,
    closeTab,
    closeActive,
    cycle,
    renameTab,
    reorder,
  }
}
