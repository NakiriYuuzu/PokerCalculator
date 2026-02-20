import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    createManualDetector,
    createMockClassifier,
    createOnnxDetector
} from '../extractors/yolo/adapters'
import { YoloCardPipeline } from '../extractors/yolo/yoloPipeline'

const MIN_BOX_SIZE = 16
const DEFAULT_MODEL_URL = `${import.meta.env.BASE_URL}models/card-detector.onnx`
const DEFAULT_LABELS_URL = `${import.meta.env.BASE_URL}models/card-detector.labels.json`
const IOU_MATCH_THRESHOLD = 0.35

const getBoxFromPoints = (start, end) => {
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    const width = Math.abs(end.x - start.x)
    const height = Math.abs(end.y - start.y)
    return { x, y, width, height }
}

const computeIoU = (a, b) => {
    const x1 = Math.max(a.x, b.x)
    const y1 = Math.max(a.y, b.y)
    const x2 = Math.min(a.x + a.width, b.x + b.width)
    const y2 = Math.min(a.y + a.height, b.y + b.height)

    const w = Math.max(0, x2 - x1)
    const h = Math.max(0, y2 - y1)
    const inter = w * h
    if (!inter) return 0

    const areaA = a.width * a.height
    const areaB = b.width * b.height
    const union = areaA + areaB - inter
    if (!union) return 0

    return inter / union
}

const attachPreviousCardsByIoU = (nextItems, prevItems) => {
    if (prevItems.length === 0) return nextItems

    const usedPrev = new Set()

    return nextItems.map(next => {
        let bestIdx = -1
        let bestIoU = 0

        for (let i = 0; i < prevItems.length; i++) {
            if (usedPrev.has(i)) continue
            const prev = prevItems[i]
            const iou = computeIoU(next.bbox, prev.bbox)
            if (iou > bestIoU) {
                bestIoU = iou
                bestIdx = i
            }
        }

        if (bestIdx >= 0 && bestIoU > IOU_MATCH_THRESHOLD && prevItems[bestIdx].card) {
            usedPrev.add(bestIdx)
            return {
                ...next,
                card: prevItems[bestIdx].card,
                confidence: Math.max(next.confidence ?? 0, prevItems[bestIdx].confidence ?? 0)
            }
        }

        return next
    })
}

const CardBatchExtractor = ({ cardOptions, onImportCards, remainingSlots }) => {
    const canvasRef = useRef(null)
    const videoRef = useRef(null)
    const imageRef = useRef(null)
    const startPointRef = useRef(null)
    const modelObjectUrlRef = useRef(null)

    const realtimeCanvasRef = useRef(null)
    const realtimeStreamRef = useRef(null)
    const realtimeActiveRef = useRef(false)
    const realtimeBusyRef = useRef(false)
    const realtimeLastTickRef = useRef(0)
    const realtimeRafRef = useRef(null)
    const realtimeFpsRef = useRef(8)
    const realtimeAutoImportAskedRef = useRef(false)

    const detectorCacheRef = useRef({
        key: null,
        pipeline: null
    })

    const [imageInfo, setImageInfo] = useState(null)
    const [manualBoxes, setManualBoxes] = useState([])
    const [draftBox, setDraftBox] = useState(null)
    const [isDrawing, setIsDrawing] = useState(false)

    const [detectedItems, setDetectedItems] = useState([])
    const [extractMessage, setExtractMessage] = useState('')
    const [isExtracting, setIsExtracting] = useState(false)

    const [yoloModelUrl, setYoloModelUrl] = useState(DEFAULT_MODEL_URL)
    const [yoloModelLabel, setYoloModelLabel] = useState('預設模型路徑')
    const [classNamesMap, setClassNamesMap] = useState({})
    const [preferWebGPU, setPreferWebGPU] = useState(true)
    const [yoloConfidence, setYoloConfidence] = useState(0.35)
    const [yoloInputSize, setYoloInputSize] = useState(416)

    const [realtimeFps, setRealtimeFps] = useState(8)
    const [isRealtimeRunning, setIsRealtimeRunning] = useState(false)
    const [realtimeLatencyMs, setRealtimeLatencyMs] = useState(null)
    const [realtimeDetections, setRealtimeDetections] = useState(0)

    const canImport = detectedItems.some(item => !!item.card)
    const cardValueSet = useMemo(() => new Set(cardOptions), [cardOptions])
    const classNamesVersion = useMemo(() => {
        const keys = Object.keys(classNamesMap)
        return `${keys.length}:${keys[0] || ''}`
    }, [classNamesMap])

    useEffect(() => {
        realtimeFpsRef.current = Math.max(1, realtimeFps)
    }, [realtimeFps])

    const resetDetectionData = useCallback(() => {
        setManualBoxes([])
        setDraftBox(null)
        setDetectedItems([])
        setExtractMessage('')
        setRealtimeDetections(0)
        setRealtimeLatencyMs(null)
        realtimeAutoImportAskedRef.current = false
    }, [])

    const stopRealtime = useCallback((silent = false) => {
        realtimeActiveRef.current = false

        if (realtimeRafRef.current) {
            cancelAnimationFrame(realtimeRafRef.current)
            realtimeRafRef.current = null
        }

        if (realtimeStreamRef.current) {
            realtimeStreamRef.current.getTracks().forEach(track => track.stop())
            realtimeStreamRef.current = null
        }

        if (videoRef.current) {
            videoRef.current.pause()
            videoRef.current.srcObject = null
        }

        realtimeBusyRef.current = false
        realtimeAutoImportAskedRef.current = false
        setIsRealtimeRunning(false)

        if (!silent) {
            setExtractMessage('已停止即時偵測')
        }
    }, [])

    useEffect(() => {
        return () => {
            stopRealtime(true)
            if (modelObjectUrlRef.current) {
                URL.revokeObjectURL(modelObjectUrlRef.current)
            }
        }
    }, [stopRealtime])

    useEffect(() => {
        const loadDefaultLabels = async () => {
            try {
                const res = await fetch(DEFAULT_LABELS_URL)
                if (!res.ok) throw new Error('labels not found')
                const json = await res.json()
                setClassNamesMap(json || {})
            } catch {
                setClassNamesMap({})
            } finally {
                detectorCacheRef.current = { key: null, pipeline: null }
            }
        }

        loadDefaultLabels()
    }, [])

    const getCanvasPoint = (event) => {
        const canvas = canvasRef.current
        if (!canvas) return null

        const rect = canvas.getBoundingClientRect()
        const scaleX = canvas.width / rect.width
        const scaleY = canvas.height / rect.height

        return {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        }
    }

    const getSourceCanvas = () => {
        const canvas = canvasRef.current
        const image = imageRef.current
        if (!canvas || !image) return null

        const sourceCanvas = document.createElement('canvas')
        sourceCanvas.width = canvas.width
        sourceCanvas.height = canvas.height
        const ctx = sourceCanvas.getContext('2d')
        ctx.drawImage(image, 0, 0, sourceCanvas.width, sourceCanvas.height)

        return sourceCanvas
    }

    const mapClassLabelToCardValue = useCallback((label) => {
        if (!label || typeof label !== 'string') return null

        const normalized = label.trim().toUpperCase()
        const compact = normalized.replace(/[^A-Z0-9]/g, '')

        if (compact.includes('JOKER')) return 'Joker'
        if (compact.includes('ACE')) return 'A'
        if (compact.includes('KING')) return 'K'
        if (compact.includes('QUEEN')) return 'Q'
        if (compact.includes('JACK')) return 'J'

        const suitPattern = /(10|[2-9]|A|J|Q|K)[CDHS]$/
        const withSuit = compact.match(suitPattern)
        if (withSuit) return withSuit[1]

        const rankOnly = compact.match(/^(10|[2-9]|A|J|Q|K)$/)
        if (rankOnly) return rankOnly[1]

        const digit = compact.match(/10|[2-9]/)
        if (digit) return digit[0]

        return null
    }, [])

    const applyDetections = useCallback((results, prefix, options = {}) => {
        const { confirmAutoFill = false } = options

        let normalized = results.map((item, index) => {
            const classLabel = item.className || classNamesMap[item.classId] || classNamesMap[String(item.classId)] || null
            const autoCard = mapClassLabelToCardValue(classLabel)

            return {
                ...item,
                className: classLabel,
                card: autoCard,
                detectionId: `${prefix}-${index + 1}`
            }
        })

        let autoFilledCount = normalized.filter(item => !!item.card).length

        if (confirmAutoFill && autoFilledCount > 0 && typeof window !== 'undefined') {
            const keepAutoFill = window.confirm(`已自動帶入 ${autoFilledCount} 張牌，是否保留？`)
            if (!keepAutoFill) {
                normalized = normalized.map(item => ({
                    ...item,
                    card: null
                }))
                autoFilledCount = 0
            }
        }

        setDetectedItems(prev => attachPreviousCardsByIoU(normalized, prev))
        setManualBoxes(normalized.map(item => ({
            id: item.detectionId,
            ...item.bbox
        })))
        setRealtimeDetections(normalized.length)

        return {
            total: normalized.length,
            autoFilled: autoFilledCount,
            autoCards: normalized
                .map(item => item.card)
                .filter(card => !!card && cardValueSet.has(card))
        }
    }, [cardValueSet, classNamesMap, mapClassLabelToCardValue])

    const createPipeline = useCallback((mode = 'image') => {
        const maxDetections = mode === 'realtime' ? 12 : 40
        const confidenceThreshold = mode === 'realtime'
            ? Math.max(0.1, yoloConfidence)
            : yoloConfidence

        const cacheKey = [
            yoloModelUrl,
            preferWebGPU,
            confidenceThreshold,
            yoloInputSize,
            maxDetections,
            classNamesVersion
        ].join('|')

        if (detectorCacheRef.current.key === cacheKey && detectorCacheRef.current.pipeline) {
            return detectorCacheRef.current.pipeline
        }

        const pipeline = new YoloCardPipeline({
            detector: createOnnxDetector({
                modelUrl: yoloModelUrl,
                modelType: 'yolov8',
                confidenceThreshold,
                inputSize: yoloInputSize,
                maxDetections,
                preferWebGPU,
                classNames: classNamesMap
            }),
            classifier: createMockClassifier(),
            minConfidence: confidenceThreshold
        })

        detectorCacheRef.current = {
            key: cacheKey,
            pipeline
        }

        return pipeline
    }, [classNamesMap, classNamesVersion, preferWebGPU, yoloConfidence, yoloInputSize, yoloModelUrl])

    const draw = () => {
        const canvas = canvasRef.current
        const image = imageRef.current
        if (!canvas || !image) return

        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)

        const drawBox = (box, label, color = '#16a34a') => {
            ctx.strokeStyle = color
            ctx.lineWidth = 2
            ctx.strokeRect(box.x, box.y, box.width, box.height)

            const tag = label || ''
            if (!tag) return
            ctx.font = '12px sans-serif'
            const textWidth = ctx.measureText(tag).width + 10
            const textHeight = 18
            const tx = box.x
            const ty = Math.max(0, box.y - textHeight)
            ctx.fillStyle = color
            ctx.fillRect(tx, ty, textWidth, textHeight)
            ctx.fillStyle = '#fff'
            ctx.fillText(tag, tx + 5, ty + 13)
        }

        manualBoxes.forEach((box, index) => {
            const matched = detectedItems.find(item => item.detectionId === box.id)
            const label = matched?.card ? `#${index + 1} ${matched.card}` : `#${index + 1}`
            drawBox(box, label, matched?.card ? '#2563eb' : '#16a34a')
        })

        if (draftBox) {
            drawBox(draftBox, '新框選', '#ef4444')
        }
    }

    useEffect(() => {
        draw()
    }, [manualBoxes, draftBox, detectedItems, imageInfo])

    const handleUpload = (event) => {
        const file = event.target.files?.[0]
        if (!file) return

        stopRealtime(true)

        const objectUrl = URL.createObjectURL(file)
        const img = new Image()
        img.onload = () => {
            const maxWidth = 860
            const scale = Math.min(1, maxWidth / img.width)
            const width = Math.max(1, Math.round(img.width * scale))
            const height = Math.max(1, Math.round(img.height * scale))

            const canvas = canvasRef.current
            if (canvas) {
                canvas.width = width
                canvas.height = height
            }

            imageRef.current = img
            setImageInfo({ name: file.name, width: img.width, height: img.height })
            resetDetectionData()
            URL.revokeObjectURL(objectUrl)
        }
        img.src = objectUrl
    }

    const handleModelFileUpload = (event) => {
        const file = event.target.files?.[0]
        if (!file) return

        if (modelObjectUrlRef.current) {
            URL.revokeObjectURL(modelObjectUrlRef.current)
        }

        const objectUrl = URL.createObjectURL(file)
        modelObjectUrlRef.current = objectUrl
        setYoloModelUrl(objectUrl)
        setYoloModelLabel(`本地模型：${file.name}`)
        setClassNamesMap({})
        detectorCacheRef.current = { key: null, pipeline: null }
        setExtractMessage(`已載入 ONNX 模型：${file.name}（若無 labels 將無法自動帶入牌面）`)
    }

    const useDefaultModelPath = async () => {
        if (modelObjectUrlRef.current) {
            URL.revokeObjectURL(modelObjectUrlRef.current)
            modelObjectUrlRef.current = null
        }

        setYoloModelUrl(DEFAULT_MODEL_URL)
        setYoloModelLabel('預設模型路徑')

        try {
            const res = await fetch(DEFAULT_LABELS_URL)
            if (!res.ok) throw new Error('labels not found')
            const json = await res.json()
            setClassNamesMap(json || {})
        } catch {
            setClassNamesMap({})
        }

        detectorCacheRef.current = { key: null, pipeline: null }
        setExtractMessage(`已切換回預設模型路徑：${DEFAULT_MODEL_URL}`)
    }

    const handleMouseDown = (event) => {
        if (!imageRef.current || isRealtimeRunning) return
        const point = getCanvasPoint(event)
        if (!point) return

        startPointRef.current = point
        setIsDrawing(true)
    }

    const handleMouseMove = (event) => {
        if (!isDrawing || !startPointRef.current) return
        const point = getCanvasPoint(event)
        if (!point) return

        setDraftBox(getBoxFromPoints(startPointRef.current, point))
    }

    const handleMouseUp = (event) => {
        if (!isDrawing || !startPointRef.current) return

        const point = getCanvasPoint(event)
        setIsDrawing(false)

        if (!point) {
            setDraftBox(null)
            return
        }

        const box = getBoxFromPoints(startPointRef.current, point)
        startPointRef.current = null
        setDraftBox(null)

        if (box.width < MIN_BOX_SIZE || box.height < MIN_BOX_SIZE) return

        setManualBoxes(prev => ([
            ...prev,
            {
                id: `box-${Date.now()}-${prev.length + 1}`,
                ...box
            }
        ]))
    }

    const confirmAndImportAutoCards = (autoCards, sourceLabel = '辨識結果') => {
        if (!autoCards || autoCards.length === 0) return null
        if (remainingSlots <= 0) return null

        if (typeof window !== 'undefined') {
            const shouldImport = window.confirm(`已從${sourceLabel}自動辨識 ${autoCards.length} 張牌，是否直接匯入計算區？`)
            if (!shouldImport) return null
        }

        return onImportCards(autoCards)
    }

    const runYoloDetector = async () => {
        if (!imageRef.current || !canvasRef.current) {
            setExtractMessage('請先上傳圖片')
            return
        }

        const sourceCanvas = getSourceCanvas()
        if (!sourceCanvas) {
            setExtractMessage('圖片來源初始化失敗')
            return
        }

        const pipeline = createPipeline('image')

        setIsExtracting(true)
        try {
            const { results } = await pipeline.extractAll(sourceCanvas)
            const applied = applyDetections(results, 'img', { confirmAutoFill: true })

            if (results.length === 0) {
                setExtractMessage('YOLO 沒有偵測到牌，請提高畫面清晰度或改用手動框選')
            } else {
                const importResult = confirmAndImportAutoCards(applied.autoCards, '圖片')
                if (importResult) {
                    setExtractMessage(`YOLO 偵測 ${applied.total} 張，已自動帶入 ${applied.autoFilled} 張，並直接匯入 ${importResult.added} 張（略過 ${importResult.skipped} 張）`)
                } else {
                    setExtractMessage(`YOLO 偵測到 ${applied.total} 張，已自動帶入 ${applied.autoFilled} 張牌，請確認後再匯入`)
                }
            }
        } catch (error) {
            setExtractMessage(`YOLO 偵測失敗：${error.message}`)
        } finally {
            setIsExtracting(false)
        }
    }

    const startRealtime = async () => {
        if (isRealtimeRunning) return

        if (!navigator.mediaDevices?.getUserMedia) {
            setExtractMessage('此裝置不支援相機存取')
            return
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            })

            const video = videoRef.current
            if (!video) {
                stream.getTracks().forEach(track => track.stop())
                return
            }

            video.srcObject = stream
            await video.play()

            const rtCanvas = document.createElement('canvas')
            rtCanvas.width = Math.max(1, video.videoWidth || 640)
            rtCanvas.height = Math.max(1, video.videoHeight || 480)
            realtimeCanvasRef.current = rtCanvas
            realtimeStreamRef.current = stream

            const pipeline = createPipeline('realtime')

            realtimeActiveRef.current = true
            realtimeBusyRef.current = false
            realtimeLastTickRef.current = 0
            realtimeAutoImportAskedRef.current = false
            setIsRealtimeRunning(true)
            setExtractMessage('即時偵測啟動中（低延遲模式）')

            const loop = async (ts) => {
                if (!realtimeActiveRef.current) return

                realtimeRafRef.current = requestAnimationFrame(loop)
                const intervalMs = 1000 / Math.max(1, realtimeFpsRef.current)
                if (ts - realtimeLastTickRef.current < intervalMs) return
                if (realtimeBusyRef.current) return

                realtimeBusyRef.current = true
                realtimeLastTickRef.current = ts

                try {
                    const source = realtimeCanvasRef.current
                    const ctx = source.getContext('2d')
                    ctx.drawImage(video, 0, 0, source.width, source.height)

                    const startedAt = performance.now()
                    const { results } = await pipeline.extractAll(source)
                    const latency = performance.now() - startedAt

                    const applied = applyDetections(results, 'rt')

                    let importSummary = ''
                    if (!realtimeAutoImportAskedRef.current && applied.autoCards.length > 0) {
                        realtimeAutoImportAskedRef.current = true
                        const importResult = confirmAndImportAutoCards(applied.autoCards, '即時偵測')
                        if (importResult) {
                            importSummary = `，已匯入 ${importResult.added} 張（略過 ${importResult.skipped} 張）`
                        }
                    }

                    setRealtimeLatencyMs(Math.round(latency))
                    setExtractMessage(`即時偵測中：${applied.total} 張，已自動帶入 ${applied.autoFilled} 張${importSummary}（${Math.round(latency)} ms）`)
                } catch (error) {
                    setExtractMessage(`即時偵測失敗：${error.message}`)
                } finally {
                    realtimeBusyRef.current = false
                }
            }

            realtimeRafRef.current = requestAnimationFrame(loop)
        } catch (error) {
            stopRealtime(true)
            setExtractMessage(`無法啟動即時偵測：${error.message}`)
        }
    }

    const captureCurrentFrame = () => {
        const video = videoRef.current
        const source = realtimeCanvasRef.current
        if (!video || !source) {
            setExtractMessage('目前沒有可截取的即時畫面')
            return
        }

        const canvas = canvasRef.current
        if (!canvas) return

        const width = source.width
        const height = source.height
        canvas.width = width
        canvas.height = height

        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, width, height)

        const img = new Image()
        img.onload = () => {
            imageRef.current = img
            setImageInfo({ name: '即時畫面截圖', width, height })
            setExtractMessage('已將即時畫面截成可編輯圖片，可手動框選修正')
        }
        img.src = canvas.toDataURL('image/png')
    }

    const runManualExtraction = async () => {
        if (!imageRef.current || !canvasRef.current) {
            setExtractMessage('請先上傳圖片或截取即時畫面')
            return
        }
        if (manualBoxes.length === 0) {
            setExtractMessage('請先在圖片上拖曳框出牌的位置')
            return
        }

        const sourceCanvas = getSourceCanvas()
        if (!sourceCanvas) {
            setExtractMessage('圖片來源初始化失敗')
            return
        }

        const pipeline = new YoloCardPipeline({
            detector: createManualDetector(manualBoxes),
            classifier: createMockClassifier(),
            minConfidence: 0.4
        })

        setIsExtracting(true)
        try {
            const { results } = await pipeline.extractAll(sourceCanvas)
            applyDetections(results, 'manual')
            setExtractMessage(`已擷取 ${results.length} 個框選區塊，請逐張確認牌面`)
        } catch (error) {
            setExtractMessage(`手動框選擷取失敗：${error.message}`)
        } finally {
            setIsExtracting(false)
        }
    }

    const updateDetectedCard = (detectionId, card) => {
        setDetectedItems(prev => prev.map(item =>
            item.detectionId === detectionId
                ? { ...item, card: card || null, confidence: card ? 1 : item.confidence }
                : item
        ))
    }

    const handleImport = () => {
        const cardValues = detectedItems
            .map(item => item.card)
            .filter(card => !!card && cardValueSet.has(card))

        if (cardValues.length === 0) {
            setExtractMessage('尚未選擇可匯入的牌')
            return
        }

        const result = onImportCards(cardValues)
        setExtractMessage(`已匯入 ${result.added} 張，略過 ${result.skipped} 張`)
    }

    return (
        <div className="border rounded-lg p-4 mb-4 bg-slate-50">
            <div className="flex flex-col gap-2 mb-3">
                <p className="font-semibold">Phase 2：YOLO 即時低延遲 + 批次擷取</p>
                <p className="text-xs text-gray-600">
                    即時模式會重複從相機取幀做 YOLO 推論（WebGPU 優先），並可隨時截圖改為手動框選修正。
                </p>
                <p className="text-xs text-gray-500">目前尚可加入：{remainingSlots} 張</p>
            </div>

            <div className="grid md:grid-cols-2 gap-3 mb-3 text-sm">
                <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-600">圖片來源</span>
                    <input
                        type="file"
                        accept="image/*"
                        onChange={handleUpload}
                        className="text-sm"
                    />
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs text-gray-600">YOLO ONNX 模型（可選）</span>
                    <input
                        type="file"
                        accept=".onnx"
                        onChange={handleModelFileUpload}
                        className="text-sm"
                    />
                </label>
            </div>

            <div className="flex flex-wrap items-center gap-2 mb-3 text-sm">
                <input
                    type="text"
                    value={yoloModelUrl}
                    onChange={(e) => {
                        setYoloModelUrl(e.target.value)
                        setYoloModelLabel('自訂模型路徑')
                        detectorCacheRef.current = { key: null, pipeline: null }
                    }}
                    className="border rounded px-2 py-1 min-w-[260px]"
                    placeholder="YOLO ONNX URL"
                />
                <button
                    type="button"
                    className="px-3 py-1 rounded bg-slate-600 text-white hover:bg-slate-700"
                    onClick={useDefaultModelPath}
                >
                    預設路徑
                </button>
                <span className="text-xs text-gray-600">{yoloModelLabel}</span>
                <span className={`text-xs ${Object.keys(classNamesMap).length > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    labels: {Object.keys(classNamesMap).length > 0 ? `已載入 ${Object.keys(classNamesMap).length} 類` : '未載入（將無法自動帶入）'}
                </span>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-1 text-sm">
                <label className="inline-flex items-center gap-2">
                    <span>信心門檻</span>
                    <input
                        type="number"
                        min="0.05"
                        max="0.95"
                        step="0.05"
                        value={yoloConfidence}
                        disabled={isRealtimeRunning}
                        onChange={(e) => {
                            setYoloConfidence(Number(e.target.value))
                            detectorCacheRef.current = { key: null, pipeline: null }
                        }}
                        className="w-20 border rounded px-2 py-1"
                    />
                </label>

                <label className="inline-flex items-center gap-2">
                    <span>輸入尺寸</span>
                    <select
                        value={yoloInputSize}
                        disabled={isRealtimeRunning}
                        onChange={(e) => {
                            setYoloInputSize(Number(e.target.value))
                            detectorCacheRef.current = { key: null, pipeline: null }
                        }}
                        className="border rounded px-2 py-1"
                    >
                        <option value={320}>320（最快）</option>
                        <option value={416}>416（建議）</option>
                        <option value={640}>640（較準）</option>
                    </select>
                </label>

                <label className="inline-flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={preferWebGPU}
                        disabled={isRealtimeRunning}
                        onChange={(e) => {
                            setPreferWebGPU(e.target.checked)
                            detectorCacheRef.current = { key: null, pipeline: null }
                        }}
                    />
                    優先 WebGPU（不支援時回落 WASM）
                </label>
            </div>

            {isRealtimeRunning && (
                <p className="text-xs text-amber-700 mb-3">即時偵測運行中，若要套用模型/門檻/尺寸設定請先停止再重啟。</p>
            )}

            <div className="border rounded p-3 mb-3 bg-white/70">
                <div className="flex flex-wrap items-center gap-3 mb-2 text-sm">
                    <label className="inline-flex items-center gap-2">
                        <span>即時 FPS</span>
                        <input
                            type="number"
                            min="1"
                            max="30"
                            step="1"
                            value={realtimeFps}
                            onChange={(e) => setRealtimeFps(Number(e.target.value) || 1)}
                            className="w-20 border rounded px-2 py-1"
                        />
                    </label>

                    <button
                        type="button"
                        className={`px-3 py-2 rounded text-white ${isRealtimeRunning ? 'bg-orange-600 hover:bg-orange-700' : 'bg-indigo-600 hover:bg-indigo-700'} disabled:bg-gray-400`}
                        disabled={isExtracting}
                        onClick={() => {
                            if (isRealtimeRunning) stopRealtime()
                            else startRealtime()
                        }}
                    >
                        {isRealtimeRunning ? '停止即時偵測' : '啟動即時偵測'}
                    </button>

                    <button
                        type="button"
                        className="px-3 py-2 rounded bg-slate-600 text-white hover:bg-slate-700 disabled:bg-gray-400"
                        disabled={!isRealtimeRunning}
                        onClick={captureCurrentFrame}
                    >
                        截取目前畫面
                    </button>

                    {isRealtimeRunning && (
                        <span className="text-xs text-gray-700">
                            detections: {realtimeDetections} · latency: {realtimeLatencyMs ?? '-'} ms
                        </span>
                    )}
                </div>

                <video
                    ref={videoRef}
                    className={`w-full max-w-md rounded border ${isRealtimeRunning ? 'block' : 'hidden'}`}
                    playsInline
                    muted
                />
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
                <button
                    type="button"
                    className="px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-400"
                    disabled={isExtracting || !imageInfo}
                    onClick={runYoloDetector}
                >
                    {isExtracting ? '處理中...' : 'YOLO 單張偵測'}
                </button>
                <button
                    type="button"
                    className="px-3 py-2 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:bg-gray-400"
                    disabled={isExtracting || !imageInfo || manualBoxes.length === 0}
                    onClick={runManualExtraction}
                >
                    手動框選擷取
                </button>
                <button
                    type="button"
                    className="px-3 py-2 rounded bg-gray-500 text-white hover:bg-gray-600 disabled:bg-gray-400"
                    disabled={!imageInfo && !detectedItems.length}
                    onClick={resetDetectionData}
                >
                    清除結果
                </button>
            </div>

            {imageInfo && (
                <div className="mb-3 text-xs text-gray-600">
                    檔案：{imageInfo.name}（原始尺寸 {imageInfo.width} × {imageInfo.height}）
                </div>
            )}

            <div className={`overflow-auto mb-3 ${imageInfo ? 'block' : 'hidden'}`}>
                <canvas
                    ref={canvasRef}
                    className="border rounded max-w-full bg-black/5 cursor-crosshair"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                />
            </div>

            {detectedItems.length > 0 && (
                <div className="space-y-2 mb-3">
                    <p className="text-sm font-medium">偵測結果（可人工校正牌面）</p>
                    {detectedItems.map((item, index) => (
                        <div key={`${item.detectionId || index}-${index}`} className="flex flex-wrap items-center gap-2 text-sm bg-white border rounded p-2">
                            <span className="font-medium">#{index + 1}</span>
                            <span className="text-xs text-gray-600">
                                box conf: {Math.round((item.detectionConfidence ?? 0) * 100)}%
                            </span>
                            <select
                                value={item.card || ''}
                                onChange={(e) => updateDetectedCard(item.detectionId, e.target.value)}
                                className="border rounded px-2 py-1"
                            >
                                <option value="">請選擇牌面</option>
                                {cardOptions.map(card => (
                                    <option key={card} value={card}>{card}</option>
                                ))}
                            </select>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    className="px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-400"
                    disabled={!canImport || remainingSlots <= 0}
                    onClick={handleImport}
                >
                    匯入到已選牌
                </button>
                {extractMessage && <p className="text-sm text-gray-700">{extractMessage}</p>}
            </div>
        </div>
    )
}

export default CardBatchExtractor
