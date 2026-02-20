const DEFAULT_INPUT_SIZE = 640
const DEFAULT_MAX_DETECTIONS = 40
const DEFAULT_IOU_THRESHOLD = 0.45
const DEFAULT_CONFIDENCE_THRESHOLD = 0.35

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

const computeIoU = (a, b) => {
    const x1 = Math.max(a.x, b.x)
    const y1 = Math.max(a.y, b.y)
    const x2 = Math.min(a.x + a.width, b.x + b.width)
    const y2 = Math.min(a.y + a.height, b.y + b.height)

    const interW = Math.max(0, x2 - x1)
    const interH = Math.max(0, y2 - y1)
    const interArea = interW * interH
    if (interArea <= 0) return 0

    const union = a.width * a.height + b.width * b.height - interArea
    if (union <= 0) return 0
    return interArea / union
}

const runNms = (detections, iouThreshold, maxDetections) => {
    const sorted = [...detections].sort((a, b) => b.confidence - a.confidence)
    const picked = []

    while (sorted.length > 0 && picked.length < maxDetections) {
        const candidate = sorted.shift()
        picked.push(candidate)

        for (let i = sorted.length - 1; i >= 0; i--) {
            const overlap = computeIoU(candidate.bbox, sorted[i].bbox)
            if (overlap > iouThreshold) {
                sorted.splice(i, 1)
            }
        }
    }

    return picked
}

const toFloatTensorInput = async (sourceCanvas, inputWidth, inputHeight, ort) => {
    const srcW = sourceCanvas.width
    const srcH = sourceCanvas.height
    const scale = Math.min(inputWidth / srcW, inputHeight / srcH)

    const scaledW = Math.round(srcW * scale)
    const scaledH = Math.round(srcH * scale)
    const padX = Math.floor((inputWidth - scaledW) / 2)
    const padY = Math.floor((inputHeight - scaledH) / 2)

    const canvas = document.createElement('canvas')
    canvas.width = inputWidth
    canvas.height = inputHeight
    const ctx = canvas.getContext('2d')

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, inputWidth, inputHeight)
    ctx.drawImage(sourceCanvas, 0, 0, srcW, srcH, padX, padY, scaledW, scaledH)

    const imageData = ctx.getImageData(0, 0, inputWidth, inputHeight).data
    const pixels = inputWidth * inputHeight
    const input = new Float32Array(3 * pixels)

    for (let i = 0; i < pixels; i++) {
        const r = imageData[i * 4] / 255
        const g = imageData[i * 4 + 1] / 255
        const b = imageData[i * 4 + 2] / 255
        input[i] = r
        input[pixels + i] = g
        input[pixels * 2 + i] = b
    }

    return {
        tensor: new ort.Tensor('float32', input, [1, 3, inputHeight, inputWidth]),
        meta: {
            srcW,
            srcH,
            inputWidth,
            inputHeight,
            scale,
            padX,
            padY
        }
    }
}

const isLikelyNormalized = (v) => v >= 0 && v <= 1.5

const convertToSourceBox = (cx, cy, w, h, meta) => {
    const { inputWidth, inputHeight, scale, padX, padY, srcW, srcH } = meta

    const norm = isLikelyNormalized(cx) && isLikelyNormalized(cy) && isLikelyNormalized(w) && isLikelyNormalized(h)
    const xCenter = norm ? cx * inputWidth : cx
    const yCenter = norm ? cy * inputHeight : cy
    const width = norm ? w * inputWidth : w
    const height = norm ? h * inputHeight : h

    const x1Input = xCenter - width / 2
    const y1Input = yCenter - height / 2
    const x2Input = xCenter + width / 2
    const y2Input = yCenter + height / 2

    const x1 = clamp((x1Input - padX) / scale, 0, srcW)
    const y1 = clamp((y1Input - padY) / scale, 0, srcH)
    const x2 = clamp((x2Input - padX) / scale, 0, srcW)
    const y2 = clamp((y2Input - padY) / scale, 0, srcH)

    const boxW = Math.max(0, x2 - x1)
    const boxH = Math.max(0, y2 - y1)
    return { x: x1, y: y1, width: boxW, height: boxH }
}

const argmax = (arr) => {
    let idx = 0
    let max = arr[0] ?? -Infinity
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] > max) {
            max = arr[i]
            idx = i
        }
    }
    return [idx, max]
}

const parseRow = (row, modelType) => {
    // YOLOv8 常見輸出: [cx, cy, w, h, class1, class2, ...]
    if (modelType === 'yolov8') {
        const classScores = row.slice(4)
        const [classId, classScore] = argmax(classScores)
        return {
            cx: row[0],
            cy: row[1],
            w: row[2],
            h: row[3],
            classId,
            confidence: classScore
        }
    }

    // YOLOv5 常見輸出: [cx, cy, w, h, objectness, class1, class2, ...]
    const objectness = row[4] ?? 0
    const classScores = row.slice(5)
    const [classId, classScore] = argmax(classScores)
    return {
        cx: row[0],
        cy: row[1],
        w: row[2],
        h: row[3],
        classId,
        confidence: objectness * classScore
    }
}

const parseOutputTensor = (outputTensor, meta, options) => {
    const {
        modelType,
        confidenceThreshold,
        iouThreshold,
        maxDetections
    } = options

    const { data, dims } = outputTensor

    if (!dims || dims.length < 2) {
        throw new Error(`不支援的輸出維度: ${JSON.stringify(dims)}`)
    }

    let rows = 0
    let attrs = 0
    let getValue

    if (dims.length === 2) {
        ;[rows, attrs] = dims
        getValue = (r, c) => data[r * attrs + c]
    } else if (dims.length === 3) {
        const [, d1, d2] = dims

        // 例如 [1,84,8400] (channels first) / [1,8400,84] (channels last)
        const channelsFirst = d1 <= 128 && d2 > d1
        if (channelsFirst) {
            attrs = d1
            rows = d2
            getValue = (r, c) => data[c * rows + r]
        } else {
            rows = d1
            attrs = d2
            getValue = (r, c) => data[r * attrs + c]
        }
    } else {
        throw new Error(`目前僅支援 2D/3D 輸出，收到 dims=${JSON.stringify(dims)}`)
    }

    const minAttrs = modelType === 'yolov8' ? 5 : 6
    if (attrs < minAttrs) {
        throw new Error(`輸出 attrs 過少 (${attrs})，與 ${modelType} 不相容`)
    }

    const rawDetections = []

    for (let r = 0; r < rows; r++) {
        const row = new Array(attrs)
        for (let c = 0; c < attrs; c++) {
            row[c] = getValue(r, c)
        }

        const parsed = parseRow(row, modelType)
        if (!Number.isFinite(parsed.confidence) || parsed.confidence < confidenceThreshold) {
            continue
        }

        const bbox = convertToSourceBox(parsed.cx, parsed.cy, parsed.w, parsed.h, meta)
        if (bbox.width < 4 || bbox.height < 4) continue

        rawDetections.push({
            bbox,
            confidence: parsed.confidence,
            classId: parsed.classId
        })
    }

    return runNms(rawDetections, iouThreshold, maxDetections)
}

const toPositiveInt = (value) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return Math.round(value)
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
        const parsed = Number(value)
        if (parsed > 0) return parsed
    }
    return null
}

const resolveModelInputShape = (session, inputName, fallbackSize) => {
    const dims = session?.inputMetadata?.[inputName]?.dimensions || []

    // 預設 NCHW: [N,3,H,W]
    const maybeHeight = toPositiveInt(dims[2])
    const maybeWidth = toPositiveInt(dims[3])

    return {
        inputWidth: maybeWidth || fallbackSize,
        inputHeight: maybeHeight || fallbackSize
    }
}

export const createOnnxYoloDetector = ({
    modelUrl,
    modelType = 'yolov8',
    inputSize = DEFAULT_INPUT_SIZE,
    confidenceThreshold = DEFAULT_CONFIDENCE_THRESHOLD,
    iouThreshold = DEFAULT_IOU_THRESHOLD,
    maxDetections = DEFAULT_MAX_DETECTIONS,
    preferWebGPU = true
} = {}) => {
    if (!modelUrl) {
        throw new Error('未提供 ONNX 模型路徑')
    }

    let sessionPromise = null

    const ensureSession = async () => {
        if (sessionPromise) return sessionPromise

        sessionPromise = (async () => {
            const ort = await import('onnxruntime-web')

            if (preferWebGPU) {
                try {
                    return await ort.InferenceSession.create(modelUrl, {
                        executionProviders: ['webgpu', 'wasm']
                    })
                } catch {
                    return ort.InferenceSession.create(modelUrl, {
                        executionProviders: ['wasm']
                    })
                }
            }

            return ort.InferenceSession.create(modelUrl, {
                executionProviders: ['wasm']
            })
        })()

        return sessionPromise
    }

    return {
        async detect(sourceCanvas) {
            if (!sourceCanvas) return []

            const session = await ensureSession()
            const ort = await import('onnxruntime-web')

            const inputName = session.inputNames[0]
            const outputName = session.outputNames[0]
            const { inputWidth, inputHeight } = resolveModelInputShape(session, inputName, inputSize)

            const { tensor, meta } = await toFloatTensorInput(sourceCanvas, inputWidth, inputHeight, ort)
            const outputs = await session.run({ [inputName]: tensor })
            const outputTensor = outputs[outputName]

            const detections = parseOutputTensor(outputTensor, meta, {
                modelType,
                confidenceThreshold,
                iouThreshold,
                maxDetections
            })

            return detections.map((det, index) => ({
                id: `onnx-${Date.now()}-${index + 1}`,
                bbox: det.bbox,
                confidence: det.confidence,
                classId: det.classId
            }))
        }
    }
}
