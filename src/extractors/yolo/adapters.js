/**
 * YOLO adapters scaffolding
 * 實際模型會在 Phase-2 接入（ONNX / WebGPU）。
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
