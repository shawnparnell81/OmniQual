import { useState } from 'react'
import type { WorkspaceTab } from '../hooks/useTabs.ts'

type Props = {
  tabs: WorkspaceTab[]
  activeId: string | null
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onReorder: (fromId: string, toId: string) => void
}

export function TabBar({ tabs, activeId, onActivate, onClose, onReorder }: Props) {
  const [dragId, setDragId] = useState<string | null>(null)

  if (tabs.length === 0) {
    return (
      <div className="tabbar empty">
        <p>Open a department folder to start a workspace tab.</p>
      </div>
    )
  }

  return (
    <div className="tabbar" role="tablist" aria-label="Open documents">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={`tab ${tab.id === activeId ? 'active' : ''}`}
          draggable
          onDragStart={() => setDragId(tab.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            if (dragId) onReorder(dragId, tab.id)
            setDragId(null)
          }}
          onClick={() => onActivate(tab.id)}
        >
          <span className="tab-title">{tab.title}</span>
          <button
            type="button"
            className="tab-close"
            aria-label={`Close ${tab.title}`}
            onClick={(event) => {
              event.stopPropagation()
              onClose(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
