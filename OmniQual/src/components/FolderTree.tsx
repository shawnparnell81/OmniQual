import { useState } from 'react'
import type { NavFolder } from '../api.ts'

type Props = {
  departments: NavFolder[]
  selectedFolderId: string | null
  onOpenFolder: (folder: NavFolder) => void
}

export function FolderTree({ departments, selectedFolderId, onOpenFolder }: Props) {
  return (
    <ul className="tree" role="tree" aria-label="Departments">
      {departments.map((folder) => (
        <TreeNode
          key={folder.id}
          folder={folder}
          depth={0}
          selectedFolderId={selectedFolderId}
          onOpenFolder={onOpenFolder}
        />
      ))}
    </ul>
  )
}

function TreeNode({
  folder,
  depth,
  selectedFolderId,
  onOpenFolder,
}: {
  folder: NavFolder
  depth: number
  selectedFolderId: string | null
  onOpenFolder: (folder: NavFolder) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const hasChildren = folder.children.length > 0
  const selected = selectedFolderId === folder.id

  return (
    <li role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={selected}>
      <div className={`tree-row ${selected ? 'selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}>
        {hasChildren ? (
          <button
            type="button"
            className="tree-twist"
            aria-label={open ? 'Collapse' : 'Expand'}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tree-twist spacer" />
        )}
        <button type="button" className="tree-label" onClick={() => onOpenFolder(folder)}>
          <span className="tree-icon" aria-hidden="true">
            {hasChildren ? '📁' : '📄'}
          </span>
          {folder.label}
        </button>
      </div>
      {hasChildren && open ? (
        <ul role="group">
          {folder.children.map((child) => (
            <TreeNode
              key={child.id}
              folder={child}
              depth={depth + 1}
              selectedFolderId={selectedFolderId}
              onOpenFolder={onOpenFolder}
            />
          ))}
        </ul>
      ) : null}
    </li>
  )
}
