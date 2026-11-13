import { useEffect, useRef } from 'react'
import { useMap } from 'react-leaflet'
import * as L from 'leaflet'
import { formatMapDistance, horizontalMapDistance, spatialMapDistance } from '../utils/mapDistance'
import { sampleMapSurfaces, type MapSurfaceSample, type SurfaceHeightCandidate } from '../utils/mapSurfaceHeights'
import { surfaceModelForManifest } from '../config/mapSurfaceModels'

interface Props {
  active: boolean
  metersPerMapUnit?: number
  surfaceManifestUrl?: string
  onExit: () => void
}

/** 临时测距，不加入绘图历史或战术存档；鼠标预览仅更新自身 Leaflet 图层。 */
export default function MapMeasureTool({ active, metersPerMapUnit, surfaceManifestUrl, onExit }: Props) {
  const map = useMap()
  const exitRef = useRef(onExit)
  useEffect(() => { exitRef.current = onExit }, [onExit])

  useEffect(() => {
    if (!active) return
    const calibrated = horizontalMapDistance([0, 0], [0, 0], metersPerMapUnit) !== null
    const container = map.getContainer()
    container.classList.add('map-measure-active')
    const doubleClickZoomEnabled = map.doubleClickZoom.enabled()
    map.doubleClickZoom.disable()

    // 距离线和端点属于地图空间，随地图旋转；提示文字由 Leaflet 保持可读。
    const paneName = 'mapMeasurementPane'
    const pane = map.getPane(paneName) ?? map.createPane(paneName, map.getPane('rotatePane') ?? undefined)
    pane.style.zIndex = '740'
    pane.style.pointerEvents = 'none'
    const layers = L.layerGroup().addTo(map)
    const control = new L.Control({ position: 'topright' })
    const panel = L.DomUtil.create('div', 'map-measure-control')
    panel.setAttribute('role', 'region')
    panel.setAttribute('aria-label', '地图测距')
    L.DomEvent.disableClickPropagation(panel)
    L.DomEvent.disableScrollPropagation(panel)
    L.DomEvent.on(panel, 'pointerdown', L.DomEvent.stopPropagation)
    const heading = L.DomUtil.create('div', 'map-measure-heading', panel)
    heading.innerHTML = '<i class="fa-solid fa-ruler-combined" aria-hidden="true"></i><span>测距</span>'
    const readoutLabel = L.DomUtil.create('span', 'map-measure-readout-label', panel)
    const readout = L.DomUtil.create('strong', 'map-measure-readout', panel)
    const more = L.DomUtil.create('div', 'map-measure-metrics', panel)
    more.hidden = !surfaceManifestUrl
    const horizontalValue = L.DomUtil.create('span', '', more)
    const heightValue = L.DomUtil.create('span', '', more)
    const heightFields = L.DomUtil.create('fieldset', 'map-measure-height-fields', panel) as HTMLFieldSetElement
    heightFields.hidden = !surfaceManifestUrl
    L.DomUtil.create('legend', '', heightFields).textContent = '所在表面'
    const heightNote = L.DomUtil.create('small', 'map-measure-height-note', panel)
    heightNote.hidden = !surfaceManifestUrl
    const heightDescription = '高度来自静态模型的1米网格采样，不代表楼层编号、可通行区域或无遮挡射线。地形孔洞未还原，隧道与表面边缘可手动调整。'
    const referenceSourceNote = surfaceManifestUrl ? surfaceModelForManifest(surfaceManifestUrl)?.sourceNote : undefined
    heightNote.title = heightDescription
    const hint = L.DomUtil.create('p', 'map-measure-hint', panel)
    const actions = L.DomUtil.create('div', 'map-measure-actions', panel)
    const clear = L.DomUtil.create('button', '', actions) as HTMLButtonElement
    clear.type = 'button'
    clear.textContent = '清除'
    const exit = L.DomUtil.create('button', '', actions) as HTMLButtonElement
    exit.type = 'button'
    exit.textContent = '退出测距'
    exit.onclick = () => exitRef.current()

    let start: L.LatLng | null = null
    let finished = false
    let line: L.Polyline | null = null
    let endpoint: L.CircleMarker | null = null
    let pendingPreview: L.LatLng | null = null
    let previewFrame = 0
    let alive = true
    let displayEnd: L.LatLng | null = null
    const color = '#01ff84'

    function createHeightControl(name: string) {
      const row = L.DomUtil.create('div', 'map-measure-height-row', heightFields)
      const caption = L.DomUtil.create('label', '', row)
      caption.textContent = name
      const select = L.DomUtil.create('select', '', caption) as HTMLSelectElement
      select.setAttribute('aria-label', `${name}所在表面`)
      const manualWrap = L.DomUtil.create('label', 'map-measure-manual-height', row)
      manualWrap.hidden = true
      L.DomUtil.create('span', '', manualWrap).textContent = '相对地面'
      const input = L.DomUtil.create('input', '', manualWrap) as HTMLInputElement
      input.type = 'number'
      input.step = '0.1'
      input.inputMode = 'decimal'
      input.setAttribute('aria-label', `${name}相对地面高度（米）`)
      L.DomUtil.create('span', '', manualWrap).textContent = '米'
      const state = { sample: null as MapSurfaceSample | null, choice: '', manualOffset: 0 as number | null,
        loading: false, error: '', revision: 0, select, manualWrap, input }
      select.onchange = () => {
        const previous = selectedHeight(state)
        state.choice = select.value
        manualWrap.hidden = state.choice !== 'manual'
        if (state.choice === 'manual' && previous !== null && state.sample) {
          state.manualOffset = previous-state.sample.groundMeters
          input.value = String(Number(state.manualOffset.toFixed(2)))
        }
        updateReadouts()
      }
      input.oninput = () => {
        state.manualOffset = input.value.trim() && Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : null
        updateReadouts()
      }
      return state
    }
    const heights = [createHeightControl('起点'), createHeightControl('终点')]
    type HeightState = typeof heights[number]
    function selectedHeight(state: HeightState): number | null {
      if (!state.sample) return null
      if (state.choice === 'manual') return state.manualOffset === null ? null : state.sample.groundMeters+state.manualOffset
      return state.sample.candidates.find((candidate) => candidate.id === state.choice)?.heightMeters ?? null
    }
    function signedHeight(value: number): string {
      return `${value < 0 ? '−' : '+'}${formatMapDistance(Math.abs(value))}`
    }
    function surfaceLabel(candidate: SurfaceHeightCandidate, index: number, ground: number): string {
      if (candidate.kind === 'terrain') return '地形地面'
      return `${index === 0 ? '模型顶面' : `模型表面 ${index+1}`}（离地 ${signedHeight(candidate.heightMeters-ground)}）`
    }
    function updateReadouts() {
      const point = displayEnd ?? start
      const horizontal = start && point
        ? horizontalMapDistance([start.lat, start.lng], [point.lat, point.lng], metersPerMapUnit) : null
      const fromHeight = selectedHeight(heights[0])
      const toHeight = finished ? selectedHeight(heights[1]) : null
      const spatial = horizontal === null ? null : spatialMapDistance(horizontal, fromHeight, toHeight)
      readoutLabel.textContent = spatial === null ? '水平距离' : '空间直线距离'
      readout.textContent = horizontal === null ? calibrated ? '— 米' : '暂不可用' : formatMapDistance(spatial ?? horizontal)
      horizontalValue.textContent = `水平 ${horizontal === null ? '—' : formatMapDistance(horizontal)}`
      heightValue.textContent = `高差 ${fromHeight === null || toHeight === null ? '—' : signedHeight(toHeight-fromHeight)}`
      if (endpoint && horizontal !== null) endpoint.setTooltipContent(`${spatial === null ? '水平' : '空间直线'} ${formatMapDistance(spatial ?? horizontal)}`)
      const statusNote = heights.some((state) => state.loading) ? '正在读取端点高度…'
        : heights.some((state) => state.error) ? '部分位置无可用高度，当前保留水平测距。'
        : '默认取顶面，可选其他表面；边缘或隧道位置可手动调整。'
      const sourceNote = heights.find((state) => state.sample?.sourceNote)?.sample?.sourceNote ?? referenceSourceNote
      heightNote.textContent = sourceNote ? `${statusNote} ${sourceNote}` : statusNote
      heightNote.title = sourceNote ? `${heightDescription} ${sourceNote}` : heightDescription
    }
    function resetHeightControl(state: HeightState, message: string) {
      state.revision++
      state.sample = null
      state.choice = ''
      state.manualOffset = 0
      state.loading = false
      state.error = ''
      state.select.replaceChildren(new Option(message, ''))
      state.select.disabled = true
      state.manualWrap.hidden = true
      state.input.value = '0'
    }
    function loadHeight(index: number, point: L.LatLng) {
      if (!surfaceManifestUrl) return
      const state = heights[index]
      resetHeightControl(state, '读取高度中…')
      const revision = state.revision
      state.loading = true
      updateReadouts()
      void sampleMapSurfaces(surfaceManifestUrl, point.lat, point.lng).then((sample) => {
        if (!alive || state.revision !== revision) return
        state.loading = false
        if (!sample || !sample.candidates.length) {
          state.error = 'outside'
          state.select.replaceChildren(new Option('超出高度数据范围', ''))
        } else {
          state.sample = sample
          state.choice = sample.candidates[0].id
          const options = sample.candidates.map((candidate, order) => {
            const option = new Option(surfaceLabel(candidate, order, sample.groundMeters), candidate.id)
            option.title = `世界高度 Z：${candidate.heightMeters.toFixed(2)} 米；${sample.sampleSpacingMeters}米网格采样`
            return option
          })
          state.select.replaceChildren(...options, new Option('手动设置离地高度…', 'manual'))
          state.select.value = state.choice
          state.select.disabled = false
        }
        updateReadouts()
      }).catch(() => {
        if (!alive || state.revision !== revision) return
        state.loading = false
        state.error = 'load'
        state.select.replaceChildren(new Option('高度暂不可读取', ''))
        updateReadouts()
      })
    }
    const reset = () => {
      cancelAnimationFrame(previewFrame)
      previewFrame = 0
      pendingPreview = null
      start = null
      finished = false
      line = null
      endpoint = null
      displayEnd = null
      layers.clearLayers()
      clear.disabled = true
      heights.forEach((state, index) => resetHeightControl(state, index === 0 ? '请设置起点' : '请设置终点'))
      updateReadouts()
      hint.textContent = calibrated ? '点击地图设置起点；可拖动地图。' : '此地图尚未标定米制距离，请切换至已标定地图。'
    }
    const pointMarker = (point: L.LatLng) => L.circleMarker(point, {
      pane: paneName, radius: 4, color, weight: 2,
      fill: true, fillColor: '#0e1112', fillOpacity: 1, interactive: false,
    }).addTo(layers)
    const showEnd = (point: L.LatLng) => {
      if (!start) return
      const meters = horizontalMapDistance([start.lat, start.lng], [point.lat, point.lng], metersPerMapUnit)
      if (meters === null) return
      displayEnd = point
      line?.setLatLngs([start, point])
      if (!endpoint) {
        endpoint = pointMarker(point)
        endpoint.bindTooltip(formatMapDistance(meters), { permanent: true, direction: 'top', offset: [0, -8], className: 'map-measure-tooltip' }).openTooltip()
      } else {
        endpoint.setLatLng(point)
      }
      updateReadouts()
    }
    const onClick = (event: L.LeafletMouseEvent) => {
      if (!calibrated) return
      cancelAnimationFrame(previewFrame)
      previewFrame = 0
      pendingPreview = null
      if (!start || finished) {
        reset()
        start = L.latLng(event.latlng.lat, event.latlng.lng)
        pointMarker(start)
        line = L.polyline([start, start], { pane: paneName, color, weight: 2, dashArray: '6 4', interactive: false }).addTo(layers)
        clear.disabled = false
        loadHeight(0, start)
        updateReadouts()
        hint.textContent = '点击终点完成测距；Esc 或右键退出。'
      } else {
        finished = true
        showEnd(event.latlng)
        loadHeight(1, event.latlng)
        line?.setStyle({ dashArray: undefined })
        hint.textContent = '再次点击地图可开始新测距；Esc 或右键退出。'
      }
    }
    const onMove = (event: L.LeafletMouseEvent) => {
      if (!start || finished) return
      pendingPreview = event.latlng
      if (previewFrame) return
      previewFrame = requestAnimationFrame(() => {
        previewFrame = 0
        if (pendingPreview) showEnd(pendingPreview)
        pendingPreview = null
      })
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || (event.target instanceof Element
        && event.target.closest('input, textarea, select, [contenteditable="true"]'))) return
      event.preventDefault()
      event.stopImmediatePropagation()
      exitRef.current()
    }
    clear.onclick = reset
    control.onAdd = () => panel
    control.addTo(map)
    reset()
    map.on('click', onClick)
    map.on('mousemove', onMove)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      alive = false
      heights.forEach((state) => { state.revision++ })
      cancelAnimationFrame(previewFrame)
      map.off('click', onClick)
      map.off('mousemove', onMove)
      window.removeEventListener('keydown', onKeyDown, true)
      layers.remove()
      control.remove()
      container.classList.remove('map-measure-active')
      if (doubleClickZoomEnabled) map.doubleClickZoom.enable()
    }
  }, [active, map, metersPerMapUnit, surfaceManifestUrl])
  return null
}
