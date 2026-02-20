import React, { useEffect, useMemo, useRef, useState } from 'react'
import { createManualDetector, createMockClassifier, createMockDetector } from '../extractors/yolo/adapters'
import { YoloCardPipeline } from '../extractors/yolo/yoloPipeline'

const MIN_BOX_SIZE = 16

const getBoxFromPoints = (start, end) => {
    const x = Math.min(start.x, end.x)
    const y = Math.min(start.y, end.y)
    const width = Math.abs(end.x - start.x)
    const height = Math.abs(end.y - start.y)
    return { x, y, width, height }
}

const CardBatchExtractor = ({ cardOptions, onImportCards, remainingSlots }) => {
    const canvasRef = useRef(null)
    const imageRef = useRef(null)
    const startPointRef = useRef(null)

    const [imageInfo, setImageInfo] = useState(null)
    const [manualBoxes, setManualBoxes] = useState([])
    const [draftBox, setDraftBox] = useState(null)
    const [isDrawing, setIsDrawing] = useState(false)

    const [detectedItems, setDetectedItems] = useState([])
    const [extractMessage, setExtractMessage] = useState('')
    const [isExtracting, setIsExtracting] = useState(false)

    const canImport = detectedItems.some(item => !!item.card)

    const cardValueSet = useMemo(() => new Set(cardOptions), [cardOptions])

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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manualBoxes, draftBox, detectedItems, imageInfo])

    const resetDetectionData = () => {
        setManualBoxes([])
        setDraftBox(null)
        setDetectedItems([])
        setExtractMessage('')
    }

    const handleUpload = (event) => {
        const file = event.target.files?.[0]
        if (!file) return

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

    const handleMouseDown = (event) => {
        if (!imageRef.current) return
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

    const runYoloDetector = async () => {
        if (!imageRef.current || !canvasRef.current) {
            setExtractMessage('請先上傳圖片')
            return
        }

        const pipeline = new YoloCardPipeline({
            detector: createMockDetector(),
            classifier: createMockClassifier(),
            minConfidence: 0.4
        })

        setIsExtracting(true)
        try {
            const { results } = await pipeline.extractAll(canvasRef.current)
            setDetectedItems(results)
            setExtractMessage(results.length === 0
                ? 'YOLO 模型尚未接入，目前請改用「手動框選擷取」'
                : `YOLO 偵測到 ${results.length} 張牌`
            )
        } catch (error) {
            setExtractMessage(`YOLO 偵測失敗：${error.message}`)
        } finally {
            setIsExtracting(false)
        }
    }

    const runManualExtraction = async () => {
        if (!imageRef.current || !canvasRef.current) {
            setExtractMessage('請先上傳圖片')
            return
        }
        if (manualBoxes.length === 0) {
            setExtractMessage('請先在圖片上拖曳框出牌的位置')
            return
        }

        const pipeline = new YoloCardPipeline({
            detector: createManualDetector(manualBoxes),
            classifier: createMockClassifier(),
            minConfidence: 0.4
        })

        setIsExtracting(true)
        try {
            const { results } = await pipeline.extractAll(canvasRef.current)
            setDetectedItems(prev => {
                const oldById = new Map(prev.map(item => [item.detectionId, item]))
                return results.map(item => ({
                    ...item,
                    card: oldById.get(item.detectionId)?.card ?? item.card
                }))
            })
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
                <p className="font-semibold">Phase 2：影像批次擷取（YOLO + 手動框選）</p>
                <p className="text-xs text-gray-600">
                    先上傳照片，若 YOLO 尚未接模型可改用「手動框選擷取」；框選後可逐張校正牌面再匯入。
                </p>
                <p className="text-xs text-gray-500">目前尚可加入：{remainingSlots} 張</p>
            </div>

            <div className="flex flex-wrap gap-2 mb-3">
                <input
                    type="file"
                    accept="image/*"
                    onChange={handleUpload}
                    className="text-sm"
                />
                <button
                    type="button"
                    className="px-3 py-2 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-gray-400"
                    disabled={isExtracting || !imageInfo}
                    onClick={runYoloDetector}
                >
                    {isExtracting ? '處理中...' : 'YOLO 偵測'}
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
                    disabled={!imageInfo}
                    onClick={resetDetectionData}
                >
                    清除框選
                </button>
            </div>

            {imageInfo && (
                <div className="mb-3 text-xs text-gray-600">
                    檔案：{imageInfo.name}（原始尺寸 {imageInfo.width} × {imageInfo.height}）
                </div>
            )}

            <div className="overflow-auto mb-3">
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
                    <p className="text-sm font-medium">擷取結果（可人工校正）</p>
                    {detectedItems.map((item, index) => (
                        <div key={`${item.detectionId || index}-${index}`} className="flex flex-wrap items-center gap-2 text-sm bg-white border rounded p-2">
                            <span className="font-medium">#{index + 1}</span>
                            <span className="text-xs text-gray-600">
                                conf: {Math.round((item.detectionConfidence ?? 0) * 100)}%
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
