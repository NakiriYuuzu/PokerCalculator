import { createOnnxYoloDetector } from './onnxDetector'

/**
 * YOLO adapters
 */

export const createMockDetector = () => ({
    async detect() {
        return []
    }
})

export const createMockClassifier = () => ({
    async classify() {
        return {
            card: null,
            rank: null,
            suit: null,
            confidence: 0
        }
    }
})

/**
 * 手動框選 fallback：把使用者框出的區塊轉成 detector 輸出
 */
export const createManualDetector = (boxes = []) => ({
    async detect() {
        return boxes.map((bbox, index) => ({
            id: `manual-${index + 1}`,
            bbox,
            confidence: 0.99
        }))
    }
})

export const createOnnxDetector = (options) => createOnnxYoloDetector(options)
