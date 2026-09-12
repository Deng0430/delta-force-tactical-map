import { useEffect, useState } from 'react'
import type { ModeConfigIssue } from '../utils/modeConfigStorage'

interface Props {
  mapName: string
  issues: ModeConfigIssue[]
  onOpenModeEditor: () => void
}

/** 当前地图的数据降级提示；不阻挡地图触控，详情按需展开。 */
export default function RuntimeDataNotice({ mapName, issues, onOpenModeEditor }: Props) {
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setExpanded(false)
  }, [mapName, issues])

  if (issues.length === 0) return null

  return (
    <aside className={`runtime-data-notice${expanded ? ' expanded' : ''}`} role="status">
      <div className="runtime-data-notice-head">
        <span><i className="fa-solid fa-circle-exclamation" aria-hidden="true" />部分地图区域未加载</span>
        <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
          {expanded ? '收起' : `详情（${issues.length}）`}
        </button>
      </div>
      {expanded && (
        <div className="runtime-data-notice-details">
          <p>{mapName} 的无效数据只在运行时跳过，原始配置未被改写。</p>
          <ul>
            {issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.entityUid}-${index}`}>
                <strong>{issue.stageId || '地图'} · {issue.entityUid}</strong>
                <span>{issue.message}</span>
              </li>
            ))}
          </ul>
          <button type="button" className="runtime-data-notice-editor" onClick={onOpenModeEditor}>
            打开模式配置器修复
          </button>
        </div>
      )}
    </aside>
  )
}
