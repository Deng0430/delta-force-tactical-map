import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  mapName: string
  onRetry: () => void
  onOpenModeEditor: () => void
  children: ReactNode
}

interface State {
  error: Error | null
}

/** 地图区域最后一道保护；已知数据问题应在运行时校验层处理。 */
export default class MapRegionErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[map-region] 渲染异常，已隔离地图区域', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="map-region-error" role="alert" aria-live="polite">
        <div className="map-region-error-icon"><i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /></div>
        <h2>地图区域暂时无法显示</h2>
        <p>{this.props.mapName} 的地图渲染遇到异常。其他地图和模式切换仍可使用。</p>
        <div className="map-region-error-actions">
          <button type="button" onClick={this.props.onRetry}>重新加载地图</button>
          <button type="button" className="secondary" onClick={this.props.onOpenModeEditor}>打开模式配置器</button>
        </div>
      </section>
    )
  }
}
