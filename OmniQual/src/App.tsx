import { useCallback, useEffect, useState } from 'react'
import { api, type NavFolder, type SessionUser } from './api.ts'
import { AuditView } from './components/AuditView.tsx'
import { CalibrationView } from './components/CalibrationView.tsx'
import { DualFormView } from './components/DualFormView.tsx'
import { DiscrepancyView } from './components/DiscrepancyView.tsx'
import { DocumentView } from './components/DocumentView.tsx'
import { FolderTree } from './components/FolderTree.tsx'
import { FolderView } from './components/FolderView.tsx'
import { InspectionView } from './components/InspectionView.tsx'
import { ManagementReviewView } from './components/ManagementReviewView.tsx'
import { SupplierView } from './components/SupplierView.tsx'
import { TrainingView } from './components/TrainingView.tsx'
import { LoginScreen } from './components/LoginScreen.tsx'
import { TabBar } from './components/TabBar.tsx'
import { tabFromLinked, useTabs } from './hooks/useTabs.ts'
import type { LinkedItem } from '../../shared/types.ts'

function findFolder(nodes: NavFolder[], id: string): NavFolder | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const nested = findFolder(node.children, id)
    if (nested) return nested
  }
  return null
}

export default function App() {
  const [user, setUser] = useState<SessionUser | null>(null)
  const [boot, setBoot] = useState(true)
  const [authError, setAuthError] = useState<string | null>(null)
  const [departments, setDepartments] = useState<NavFolder[]>([])
  const [navError, setNavError] = useState<string | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const tabs = useTabs(user?.organization.id)
  const { closeActive, cycle } = tabs

  useEffect(() => {
    let cancelled = false
    api
      .me()
      .then((payload) => {
        if (!cancelled) setUser(payload.user)
      })
      .catch(() => {
        if (!cancelled) setUser(null)
      })
      .finally(() => {
        if (!cancelled) setBoot(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setDepartments([])
      return
    }
    let cancelled = false
    api
      .nav()
      .then((payload) => {
        if (!cancelled) {
          setDepartments(payload.departments)
          setNavError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setNavError(err instanceof Error ? err.message : 'Failed to load navigation')
      })
    return () => {
      cancelled = true
    }
  }, [user])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const meta = event.ctrlKey || event.metaKey
      if (!meta) return
      if (event.key.toLowerCase() === 'w') {
        event.preventDefault()
        closeActive()
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        cycle(event.shiftKey ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeActive, cycle])

  const openFolder = useCallback(
    (folder: NavFolder) => {
      tabs.openTab({
        id: `folder/${folder.slug}`,
        kind: 'folder',
        title: folder.label,
        folderId: folder.id,
      })
      setSidebarOpen(false)
    },
    [tabs],
  )

  const openLinked = useCallback(
    (item: LinkedItem) => {
      const tab = tabFromLinked(item)
      if (tab) tabs.openTab(tab)
    },
    [tabs],
  )

  async function handleLogin(email: string, password: string) {
    setAuthError(null)
    try {
      const payload = await api.login(email, password)
      setUser(payload.user)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Sign in failed')
    }
  }

  async function handleRegister(payload: {
    organizationName: string
    name: string
    email: string
    password: string
  }) {
    setAuthError(null)
    try {
      const result = await api.register(payload)
      setUser(result.user)
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Could not create organization')
    }
  }

  async function handleLogout() {
    await api.logout()
    setUser(null)
  }

  if (boot) {
    return (
      <div className="login-shell">
        <p className="muted">Loading OmniQual…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <LoginScreen error={authError} onLogin={handleLogin} onRegister={handleRegister} />
    )
  }

  const activeFolder =
    tabs.activeTab?.kind === 'folder' && tabs.activeTab.folderId
      ? findFolder(departments, tabs.activeTab.folderId)
      : null

  return (
    <div className="app">
      <header className="topbar">
        <button
          type="button"
          className="hamburger"
          aria-label={sidebarOpen ? 'Close departments' : 'Open departments'}
          aria-expanded={sidebarOpen}
          onClick={() => setSidebarOpen((open) => !open)}
        >
          ☰
        </button>
        <div className="brand">
          <strong>OmniQual</strong>
          <span>{user.organization.name}</span>
        </div>
        <div className="topbar-user">
          <span>{user.name}</span>
          <button type="button" onClick={() => void handleLogout()}>
            Sign out
          </button>
        </div>
      </header>
      <TabBar
        tabs={tabs.tabs}
        activeId={tabs.activeId}
        onActivate={tabs.activate}
        onClose={tabs.closeTab}
        onReorder={tabs.reorder}
      />
      <div className="workspace">
        <div
          className={`nav-backdrop ${sidebarOpen ? 'show' : ''}`}
          onClick={() => setSidebarOpen(false)}
        />
        <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          <p className="sidebar-label">Departments</p>
          {navError ? <p className="form-error">{navError}</p> : null}
          <FolderTree
            departments={departments}
            selectedFolderId={tabs.activeTab?.folderId ?? null}
            onOpenFolder={openFolder}
          />
        </aside>
        <main className="main">
          {!tabs.activeTab ? (
            <div className="welcome">
              <p className="brand-kicker">Workspace</p>
              <h1>Open a department folder</h1>
              <p>
                Quality work stays in tabs, like a browser. Open an NCR and a CAPA at the same time
                without losing either record.
              </p>
            </div>
          ) : null}
          {tabs.activeTab?.kind === 'folder' && activeFolder ? (
            <FolderView
              folder={activeFolder}
              onOpenRecord={(record, title) =>
                tabs.openTab({
                  id: `form/${record.id}`,
                  kind: 'form',
                  title,
                  recordId: record.id,
                  folderId: record.folderId,
                })
              }
              onCreated={(recordId, title) =>
                tabs.openTab({
                  id: `form/${recordId}`,
                  kind: 'form',
                  title,
                  recordId,
                  folderId: activeFolder.id,
                })
              }
              onOpenDocument={(documentId, title, folderId) =>
                tabs.openTab({
                  id: `document/${documentId}`,
                  kind: 'document',
                  title,
                  documentId,
                  folderId,
                })
              }
              onOpenAudit={(auditId, title, folderId) =>
                tabs.openTab({
                  id: `audit/${auditId}`,
                  kind: 'audit',
                  title,
                  auditId,
                  folderId,
                })
              }
              onOpenTraining={(trainingId, title) =>
                tabs.openTab({
                  id: `training/${trainingId}`,
                  kind: 'training',
                  title,
                  trainingId,
                })
              }
              onOpenCalibration={(calibrationId, title, folderId) =>
                tabs.openTab({
                  id: `calibration/${calibrationId}`,
                  kind: 'calibration',
                  title,
                  calibrationId,
                  folderId,
                })
              }
              onOpenSupplier={(supplierId, title, folderId) =>
                tabs.openTab({
                  id: `supplier/${supplierId}`,
                  kind: 'supplier',
                  title,
                  supplierId,
                  folderId,
                })
              }
              onOpenReview={(reviewId, title, folderId) =>
                tabs.openTab({
                  id: `review/${reviewId}`,
                  kind: 'review',
                  title,
                  reviewId,
                  folderId,
                })
              }
              onOpenDiscrepancy={(discrepancyId, title, folderId) =>
                tabs.openTab({
                  id: `discrepancy/${discrepancyId}`,
                  kind: 'discrepancy',
                  title,
                  discrepancyId,
                  folderId,
                })
              }
              onOpenInspection={(inspectionId, title, folderId) =>
                tabs.openTab({
                  id: `inspection/${inspectionId}`,
                  kind: 'inspection',
                  title,
                  inspectionId,
                  folderId,
                })
              }
            />
          ) : null}
          {tabs.activeTab?.kind === 'folder' && !activeFolder ? (
            <p className="muted">This folder is no longer in your tenant navigation.</p>
          ) : null}
          {tabs.activeTab?.kind === 'form' && tabs.activeTab.recordId ? (
            <DualFormView
              recordId={tabs.activeTab.recordId}
              onTitleChange={(title) => tabs.renameTab(tabs.activeTab!.id, title)}
              onOpenRecord={(recordId, title, folderId) =>
                tabs.openTab({
                  id: `form/${recordId}`,
                  kind: 'form',
                  title,
                  recordId,
                  folderId,
                })
              }
              onOpenLinked={openLinked}
            />
          ) : null}
          {tabs.activeTab?.kind === 'document' && tabs.activeTab.documentId ? (
            <DocumentView
              documentId={tabs.activeTab.documentId}
              onTitleChange={(title) => tabs.renameTab(tabs.activeTab!.id, title)}
              onOpenDocument={(documentId, title, folderId) =>
                tabs.openTab({
                  id: `document/${documentId}`,
                  kind: 'document',
                  title,
                  documentId,
                  folderId,
                })
              }
            />
          ) : null}
          {tabs.activeTab?.kind === 'audit' && tabs.activeTab.auditId ? (
            <AuditView
              auditId={tabs.activeTab.auditId}
              onTitleChange={(title) => tabs.renameTab(tabs.activeTab!.id, title)}
              onOpenRecord={(recordId, title, folderId) =>
                tabs.openTab({
                  id: `form/${recordId}`,
                  kind: 'form',
                  title,
                  recordId,
                  folderId,
                })
              }
              onOpenLinked={openLinked}
            />
          ) : null}
          {tabs.activeTab?.kind === 'training' && tabs.activeTab.trainingId ? (
            <TrainingView
              trainingId={tabs.activeTab.trainingId}
              currentUserId={user.id}
              onTitleChange={(title) => tabs.renameTab(tabs.activeTab!.id, title)}
              onOpenDocument={(documentId, title, folderId) =>
                tabs.openTab({
                  id: `document/${documentId}`,
                  kind: 'document',
                  title,
                  documentId,
                  folderId,
                })
              }
            />
          ) : null}
          {tabs.activeTab?.kind === 'calibration' && tabs.activeTab.calibrationId ? (
            <CalibrationView
              assetId={tabs.activeTab.calibrationId}
              onTitleChange={(title) => tabs.renameTab(tabs.activeTab!.id, title)}
              onOpenRecord={(recordId, title, folderId) =>
                tabs.openTab({
                  id: `form/${recordId}`,
                  kind: 'form',
                  title,
                  recordId,
                  folderId,
                })
              }
              onOpenLinked={openLinked}
            />
          ) : null}
          {tabs.activeTab?.kind === 'supplier' && tabs.activeTab.supplierId ? (
            <SupplierView
              supplierId={tabs.activeTab.supplierId}
              onTitleChange={(title) => tabs.renameTab(tabs.activeTab!.id, title)}
              onOpenRecord={(recordId, title, folderId) =>
                tabs.openTab({
                  id: `form/${recordId}`,
                  kind: 'form',
                  title,
                  recordId,
                  folderId,
                })
              }
              onOpenLinked={openLinked}
            />
          ) : null}
          {tabs.activeTab?.kind === 'review' && tabs.activeTab.reviewId ? (
            <ManagementReviewView
              reviewId={tabs.activeTab.reviewId}
              onTitleChange={(title) => tabs.renameTab(tabs.activeTab!.id, title)}
              onOpenRecord={(recordId, title, folderId) =>
                tabs.openTab({
                  id: `form/${recordId}`,
                  kind: 'form',
                  title,
                  recordId,
                  folderId,
                })
              }
              onOpenLinked={openLinked}
            />
          ) : null}
          {tabs.activeTab?.kind === 'discrepancy' && tabs.activeTab.discrepancyId ? (
            <DiscrepancyView
              discrepancyId={tabs.activeTab.discrepancyId}
              onTitleChange={(title) => tabs.renameTab(tabs.activeTab!.id, title)}
              onOpenRecord={(recordId, title, folderId) =>
                tabs.openTab({
                  id: `form/${recordId}`,
                  kind: 'form',
                  title,
                  recordId,
                  folderId,
                })
              }
              onOpenLinked={openLinked}
            />
          ) : null}
          {tabs.activeTab?.kind === 'inspection' && tabs.activeTab.inspectionId ? (
            <InspectionView
              inspectionId={tabs.activeTab.inspectionId}
              onTitleChange={(title) => tabs.renameTab(tabs.activeTab!.id, title)}
              onOpenRecord={(recordId, title, folderId) =>
                tabs.openTab({
                  id: `form/${recordId}`,
                  kind: 'form',
                  title,
                  recordId,
                  folderId,
                })
              }
              onOpenLinked={openLinked}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}
