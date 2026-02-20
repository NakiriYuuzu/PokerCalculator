/**
 * YOLO 半自動擷取流程（Phase-2 scaffolding）
 *
 * Pipeline:
 * 1) detector.detect(image) -> 偵測牌框
 * 2) cropper.crop(image, bbox) -> 裁切單張牌
 * 3) classifier.classify(cardImage) -> 牌面分類（rank/suit）
 */

export class YoloCardPipeline {
    constructor({ detector, classifier, minConfidence = 0.55 } = {}) {
        this.detector = detector
        this.classifier = classifier
        this.minConfidence = minConfidence
    }

    async detectCards(imageBitmapOrCanvas) {
        if (!this.detector?.detect) {
            throw new Error('YOLO detector 尚未初始化')
        }

        const detections = await this.detector.detect(imageBitmapOrCanvas)
        return detections
            .filter(det => det.confidence >= this.minConfidence)
            .sort((a, b) => b.confidence - a.confidence)
    }

    async classifyCard(cardImage) {
        if (!this.classifier?.classify) {
            throw new Error('Card classifier 尚未初始化')
        }

        return this.classifier.classify(cardImage)
    }

    async extractAll(imageBitmapOrCanvas, cropper = defaultCropper) {
        const activeCropper = cropper ?? defaultCropper
        if (!activeCropper?.crop) {
            throw new Error('Cropper 尚未初始化')
        }

        let detections = []
        try {
            detections = await this.detectCards(imageBitmapOrCanvas)
        } catch (error) {
            throw new Error(`牌框偵測失敗：${error.message}`)
        }

        const results = []

        for (const det of detections) {
            const cardImage = activeCropper.crop(imageBitmapOrCanvas, det.bbox)
            try {
                const classified = await this.classifyCard(cardImage)
                results.push({
                    bbox: det.bbox,
                    detectionConfidence: det.confidence,
                    ...classified
                })
            } catch {
                results.push({
                    bbox: det.bbox,
                    detectionConfidence: det.confidence,
                    card: null,
                    rank: null,
                    suit: null,
                    confidence: 0
                })
            }
        }

        return {
            results,
            lowConfidence: results.filter(item => (item.confidence ?? 0) < this.minConfidence)
        }
    }
}

/**
 * 預設裁切器：由 bbox 回傳 canvas
 */
export const defaultCropper = {
    crop(sourceCanvas, bbox) {
        const { x, y, width, height } = bbox
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.floor(width))
        canvas.height = Math.max(1, Math.floor(height))
        const ctx = canvas.getContext('2d')
        ctx.drawImage(
            sourceCanvas,
            Math.floor(x),
            Math.floor(y),
            Math.floor(width),
            Math.floor(height),
            0,
            0,
            canvas.width,
            canvas.height
        )
        return canvas
    }
}
