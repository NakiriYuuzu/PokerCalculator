import React, { useState, useEffect, useCallback, useRef } from 'react'
import Tesseract from 'tesseract.js'

const ROI_REGIONS = [
    { label: 'TL', x: 0.02, y: 0.02, w: 0.22, h: 0.34 },
    { label: 'TC', x: 0.39, y: 0.02, w: 0.22, h: 0.34 },
    { label: 'TR', x: 0.76, y: 0.02, w: 0.22, h: 0.34 },
    { label: 'BL', x: 0.10, y: 0.58, w: 0.22, h: 0.34 },
    { label: 'BR', x: 0.68, y: 0.58, w: 0.22, h: 0.34 }
]

const OCR_DEBOUNCE_MS = 1200
const AUTO_SCAN_INTERVAL_MS = 1600

const PokerCalculator = () => {
    const [selectedCards, setSelectedCards] = useState([])
    const [combinations, setCombinations] = useState([])
    const [mode, setMode] = useState(3)
    const [cardCounts, setCardCounts] = useState({})
    const [enableThreeSixSwap, setEnableThreeSixSwap] = useState(true)
    const [isCameraOn, setIsCameraOn] = useState(false)
    const [isRecognizing, setIsRecognizing] = useState(false)
    const [scanMessage, setScanMessage] = useState('')
    const [autoScan, setAutoScan] = useState(false)

    const videoRef = useRef(null)
    const canvasRef = useRef(null)
    const roiCanvasRef = useRef(null)
    const streamRef = useRef(null)
    const selectedCountRef = useRef(0)
    const lastDetectedRef = useRef({})
    const scanningGuardRef = useRef(false)

    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'Joker']
    const deck = values.map(value => ({
        value,
        display: value,
        numValue: value === 'A' ? 1 :
            ['J', 'Q', 'K'].includes(value) ? 10 :
                value === 'Joker' ? 'Joker' :
                    parseInt(value)
    }))

    useEffect(() => {
        selectedCountRef.current = selectedCards.length
    }, [selectedCards])

    const resetSelection = () => {
        setSelectedCards([])
        setCardCounts({})
        setCombinations([])
        setScanMessage('')
    }

    const handleCardSelect = useCallback((card) => {
        if (selectedCountRef.current >= mode) return false

        setSelectedCards(prev => {
            if (prev.length >= mode) return prev
            selectedCountRef.current = prev.length + 1
            return [...prev, card]
        })

        setCardCounts(prev => ({
            ...prev,
            [card.value]: (prev[card.value] || 0) + 1
        }))
        return true
    }, [mode])

    const normalizeDetectedCard = (token) => {
        if (!token) return null
        const text = token.toUpperCase().replace(/[^A-Z0-9]/g, '')
        if (!text) return null

        if (text.includes('JOKER')) return 'Joker'
        if (text === '10' || text.includes('10')) return '10'

        if (['A', 'K', 'Q', 'J'].includes(text)) return text

        const simple = text.match(/[2-9]/)
        if (simple) return simple[0]

        return null
    }

    const extractCardsFromOCRText = (rawText) => {
        const normalized = rawText
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()

        if (!normalized) return []

        const candidates = normalized.match(/JOKER|10|[AJQK]|[2-9]/g) || []
        return candidates
            .map(normalizeDetectedCard)
            .filter(Boolean)
    }

    const stopCamera = useCallback(() => {
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop())
            streamRef.current = null
        }
        setIsCameraOn(false)
        setAutoScan(false)
    }, [])

    const startCamera = async () => {
        try {
            if (!navigator.mediaDevices?.getUserMedia) {
                setScanMessage('此裝置或瀏覽器不支援攝像頭')
                return
            }

            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: false
            })

            streamRef.current = stream
            if (videoRef.current) {
                videoRef.current.srcObject = stream
                await videoRef.current.play()
            }

            setIsCameraOn(true)
            setScanMessage('攝像頭已啟動，可手動掃描或啟用連續掃描')
        } catch (err) {
            setScanMessage(`啟動攝像頭失敗：${err.message}`)
        }
    }

    const isDebounced = (cardValue) => {
        const now = Date.now()
        const lastAt = lastDetectedRef.current[cardValue] || 0
        if (now - lastAt < OCR_DEBOUNCE_MS) return true
        lastDetectedRef.current[cardValue] = now
        return false
    }

    const runOCRFromRegion = async (sourceCanvas, region) => {
        const roiCanvas = roiCanvasRef.current
        if (!roiCanvas) return []

        const sx = Math.max(0, Math.floor(region.x * sourceCanvas.width))
        const sy = Math.max(0, Math.floor(region.y * sourceCanvas.height))
        const sw = Math.max(1, Math.floor(region.w * sourceCanvas.width))
        const sh = Math.max(1, Math.floor(region.h * sourceCanvas.height))

        roiCanvas.width = sw
        roiCanvas.height = sh

        const roiCtx = roiCanvas.getContext('2d')
        roiCtx.drawImage(sourceCanvas, sx, sy, sw, sh, 0, 0, sw, sh)

        const { data } = await Tesseract.recognize(roiCanvas, 'eng', {
            logger: () => {},
            tessedit_char_whitelist: 'A2345678910JQKjokerJOKER'
        })

        return extractCardsFromOCRText(data.text)
    }

    const scanCurrentFrame = useCallback(async () => {
        if (!videoRef.current || !canvasRef.current || !isCameraOn || scanningGuardRef.current) return

        if (selectedCountRef.current >= mode) {
            setScanMessage('已達可選牌張數上限，請先移除或重置')
            return
        }

        scanningGuardRef.current = true
        setIsRecognizing(true)

        try {
            const video = videoRef.current
            const canvas = canvasRef.current
            const ctx = canvas.getContext('2d')

            canvas.width = video.videoWidth
            canvas.height = video.videoHeight
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

            const detectedSet = []
            for (const region of ROI_REGIONS) {
                if (selectedCountRef.current >= mode) break
                const cards = await runOCRFromRegion(canvas, region)
                cards.forEach(card => detectedSet.push(card))
            }

            // fallback: 全畫面再跑一次，補抓漏掉的字
            if (detectedSet.length === 0) {
                const { data } = await Tesseract.recognize(canvas, 'eng', {
                    logger: () => {},
                    tessedit_char_whitelist: 'A2345678910JQKjokerJOKER'
                })
                extractCardsFromOCRText(data.text).forEach(card => detectedSet.push(card))
            }

            const uniqueCards = [...new Set(detectedSet)]
            if (uniqueCards.length === 0) {
                setScanMessage('未辨識到牌面點數，請調整光線或把牌角靠近鏡頭')
                return
            }

            const added = []
            const skipped = []

            for (const cardValue of uniqueCards) {
                if (selectedCountRef.current >= mode) break
                if (isDebounced(cardValue)) {
                    skipped.push(cardValue)
                    continue
                }

                const matchedCard = deck.find(card => card.value === cardValue)
                if (!matchedCard) continue

                const ok = handleCardSelect(matchedCard)
                if (ok) added.push(cardValue)
            }

            if (added.length > 0) {
                setScanMessage(`已加入 ${added.join(', ')}${skipped.length ? `（略過重複: ${skipped.join(', ')}）` : ''}`)
            } else {
                setScanMessage(`辨識到 ${uniqueCards.join(', ')}，但都在 debounce 期間或已滿張`)
            }
        } catch (err) {
            setScanMessage(`辨識失敗：${err.message}`)
        } finally {
            setIsRecognizing(false)
            scanningGuardRef.current = false
        }
    }, [deck, handleCardSelect, isCameraOn, mode])

    useEffect(() => {
        if (!autoScan || !isCameraOn) return

        const id = setInterval(() => {
            if (selectedCountRef.current >= mode) return
            scanCurrentFrame()
        }, AUTO_SCAN_INTERVAL_MS)

        return () => clearInterval(id)
    }, [autoScan, isCameraOn, mode, scanCurrentFrame])

    useEffect(() => {
        return () => {
            stopCamera()
        }
    }, [stopCamera])

    const getCardPossibleValues = useCallback((card) => {
        if (enableThreeSixSwap && card.value === '3') return [3, 6]
        if (enableThreeSixSwap && card.value === '6') return [6, 3]
        return [card.numValue]
    }, [enableThreeSixSwap])

    const generateValueCombinations = useCallback((cards) => {
        const possibilities = cards.map(getCardPossibleValues)
        const results = []

        const generate = (index, currentSum, currentValues, conversions) => {
            if (index === cards.length) {
                results.push({ sum: currentSum, values: [...currentValues], conversions: [...conversions] })
                return
            }

            possibilities[index].forEach(value => {
                const originalValue = cards[index].numValue
                const conversion = (originalValue === 3 && value === 6) ||
                    (originalValue === 6 && value === 3)
                    ? { index, from: originalValue, to: value }
                    : null

                generate(
                    index + 1,
                    currentSum + value,
                    [...currentValues, value],
                    conversion ? [...conversions, conversion] : conversions
                )
            })
        }

        generate(0, 0, [], [])
        return results
    }, [getCardPossibleValues])

    const calculateAllPossibleSums = useCallback((cards) => {
        if (cards.length !== 3 && cards.length !== 2) return []

        const jokers = cards.filter(card => card.value === 'Joker')
        const nonJokers = cards.filter(card => card.value !== 'Joker')
        const possibleValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

        if (jokers.length === 0) {
            const valueCombinations = generateValueCombinations(cards)
            return valueCombinations.map(combo => ({
                sum: combo.sum,
                jokerValues: [],
                isValid: cards.length === 3 ? combo.sum % 10 === 0 : true,
                conversions: combo.conversions
            })).filter(result => cards.length === 2 || result.isValid)
        }

        const combinations = []
        const generateCombinations = (currentJokerIndex, currentSum, currentJokerValues, currentConversions) => {
            if (currentJokerIndex === jokers.length) {
                if (cards.length === 2 || currentSum % 10 === 0) {
                    combinations.push({
                        sum: currentSum,
                        jokerValues: [...currentJokerValues],
                        isValid: true,
                        conversions: currentConversions
                    })
                }
                return
            }

            for (const value of possibleValues) {
                generateCombinations(
                    currentJokerIndex + 1,
                    currentSum + value,
                    [...currentJokerValues, value],
                    currentConversions
                )
            }
        }

        const nonJokerCombinations = generateValueCombinations(nonJokers)
        nonJokerCombinations.forEach(nonJokerCombo => {
            generateCombinations(0, nonJokerCombo.sum, [], nonJokerCombo.conversions)
        })

        return combinations
    }, [generateValueCombinations])

    useEffect(() => {
        if (selectedCards.length === mode) {
            if (mode === 3) {
                const possibleResults = calculateAllPossibleSums(selectedCards)
                if (possibleResults.some(result => result.isValid)) {
                    setCombinations([{
                        cards: selectedCards,
                        results: possibleResults.filter(result => result.isValid),
                        remainingCards: null
                    }])
                } else {
                    setCombinations([])
                }
            } else if (mode === 5) {
                const allCombos = []
                for (let i = 0; i < selectedCards.length - 2; i++) {
                    for (let j = i + 1; j < selectedCards.length - 1; j++) {
                        for (let k = j + 1; k < selectedCards.length; k++) {
                            const combo = [selectedCards[i], selectedCards[j], selectedCards[k]]
                            const remainingCards = selectedCards.filter((_, index) =>
                                index !== i && index !== j && index !== k
                            )
                            const possibleResults = calculateAllPossibleSums(combo)
                            const validResults = possibleResults.filter(result => result.isValid)

                            if (validResults.length > 0) {
                                const remainingResults = calculateAllPossibleSums(remainingCards)
                                allCombos.push({
                                    cards: combo,
                                    results: validResults,
                                    remainingCards: {
                                        cards: remainingCards,
                                        results: remainingResults
                                    }
                                })
                            }
                        }
                    }
                }
                setCombinations(allCombos)
            }
        } else {
            setCombinations([])
        }
    }, [selectedCards, mode, calculateAllPossibleSums])

    const handleCardRemove = (index) => {
        const removedCard = selectedCards[index]
        setSelectedCards(selectedCards.filter((_, i) => i !== index))
        selectedCountRef.current = Math.max(0, selectedCountRef.current - 1)
        setCardCounts(prev => ({
            ...prev,
            [removedCard.value]: prev[removedCard.value] - 1
        }))
    }

    const renderConversions = (conversions, cards) => {
        if (!conversions || conversions.length === 0) return null

        return (
            <span className="text-blue-600 ml-2">
                (
                {conversions.map((conv, i) => (
                    <span key={i}>
                        {i > 0 && '、'}
                        {cards[conv.index].value} 當作 {conv.to}
                    </span>
                ))}
                )
            </span>
        )
    }

    return (
        <div className="max-w-4xl mx-auto p-4 bg-white rounded-lg shadow">
            <h2 className="text-xl font-bold mb-4">撲克牌計算器 (可重複選擇)</h2>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
                <p className="text-sm text-gray-600">特殊規則：3可以當作6，6可以當作3</p>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                        type="checkbox"
                        checked={enableThreeSixSwap}
                        onChange={(e) => setEnableThreeSixSwap(e.target.checked)}
                        className="rounded border-gray-300"
                    />
                    啟用 3/6 互換
                </label>
            </div>

            <div className="space-x-2 mb-4">
                <button
                    className={`px-4 py-2 rounded ${mode === 3 ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    onClick={() => {
                        setMode(3)
                        resetSelection()
                    }}
                >
                    選擇3張
                </button>
                <button
                    className={`px-4 py-2 rounded ${mode === 5 ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    onClick={() => {
                        setMode(5)
                        resetSelection()
                    }}
                >
                    選擇5張
                </button>
                <button
                    className="px-4 py-2 rounded bg-red-500 text-white"
                    onClick={resetSelection}
                >
                    重置
                </button>
            </div>

            <div className="border rounded-lg p-3 mb-4 bg-gray-50">
                <p className="font-medium mb-1">相機辨識（實驗功能）</p>
                <p className="text-xs text-gray-600 mb-2">已優化：ROI 裁切（抓牌角）+ debounce 去重 + 多張辨識</p>
                <div className="flex flex-wrap gap-2 mb-2">
                    <button
                        className={`px-3 py-2 rounded text-white ${isCameraOn ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                        disabled={isCameraOn}
                        onClick={startCamera}
                    >
                        啟動攝像頭
                    </button>
                    <button
                        className={`px-3 py-2 rounded text-white ${!isCameraOn ? 'bg-gray-400 cursor-not-allowed' : 'bg-orange-500 hover:bg-orange-600'}`}
                        disabled={!isCameraOn}
                        onClick={stopCamera}
                    >
                        停止攝像頭
                    </button>
                    <button
                        className={`px-3 py-2 rounded text-white ${(isRecognizing || !isCameraOn) ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'}`}
                        disabled={isRecognizing || !isCameraOn}
                        onClick={scanCurrentFrame}
                    >
                        {isRecognizing ? '辨識中...' : '辨識目前畫面'}
                    </button>
                    <button
                        className={`px-3 py-2 rounded text-white ${!isCameraOn ? 'bg-gray-400 cursor-not-allowed' : autoScan ? 'bg-purple-700 hover:bg-purple-800' : 'bg-purple-500 hover:bg-purple-600'}`}
                        disabled={!isCameraOn}
                        onClick={() => setAutoScan(prev => !prev)}
                    >
                        {autoScan ? '停止連續掃描' : '啟用連續掃描'}
                    </button>
                </div>
                {scanMessage && <p className="text-sm text-gray-700">{scanMessage}</p>}
                <div className="mt-3">
                    <video ref={videoRef} className={`w-full max-w-md rounded border ${isCameraOn ? 'block' : 'hidden'}`} playsInline muted />
                    <canvas ref={canvasRef} className="hidden" />
                    <canvas ref={roiCanvasRef} className="hidden" />
                </div>
            </div>

            <p>已選擇 {selectedCards.length}/{mode} 張牌</p>

            <div className="flex flex-wrap gap-2 mb-4">
                {selectedCards.map((card, index) => (
                    <button
                        key={index}
                        className="px-3 py-1 bg-blue-100 rounded-full flex items-center gap-2 hover:bg-blue-200"
                        onClick={() => handleCardRemove(index)}
                    >
                        <span>{card.display}</span>
                        <span className="text-red-500">&times;</span>
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-7 gap-2 mb-4">
                {deck.map((card, i) => (
                    <button
                        key={i}
                        className={`p-2 border rounded relative ${
                            selectedCards.length < mode
                                ? 'hover:bg-blue-50'
                                : 'opacity-50 cursor-not-allowed'
                        } ${enableThreeSixSwap && ['3', '6'].includes(card.value) ? 'border-blue-300' : ''}`}
                        onClick={() => handleCardSelect(card)}
                        disabled={selectedCards.length >= mode}
                    >
                        <span>{card.display}</span>
                        {cardCounts[card.value] > 0 && (
                            <span className="absolute top-0 right-0 -mt-2 -mr-2 bg-blue-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">
                                {cardCounts[card.value]}
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {combinations.length > 0 ? (
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold">可行組合：</h3>
                    {combinations.map((combo, i) => (
                        <div key={i} className="border rounded-lg p-4 bg-white shadow-sm">
                            <div className="mb-2">
                                <p className="font-medium">前三張: {combo.cards.map(c => c.display).join(', ')}</p>
                                {combo.results.map((result, j) => (
                                    <div key={j} className="p-2 rounded bg-green-50 border border-green-200 mt-2">
                                        <p>
                                            {result.jokerValues.length > 0 ? (
                                                <>
                                                    當 Joker 為 {result.jokerValues.join(', ')} 時，總和為 {result.sum}
                                                </>
                                            ) : (
                                                <>總和為 {result.sum}</>
                                            )}
                                            {renderConversions(result.conversions, combo.cards)}
                                        </p>
                                    </div>
                                ))}
                            </div>

                            {combo.remainingCards && (
                                <div className="mt-4 pt-2 border-t">
                                    <p className="font-medium">剩餘兩張: {combo.remainingCards.cards.map(c => c.display).join(', ')}</p>
                                    {combo.remainingCards.results.map((result, j) => (
                                        <div key={j} className="p-2 rounded bg-gray-50 border border-gray-200 mt-2">
                                            <p>
                                                {result.jokerValues.length > 0 ? (
                                                    <>
                                                        當 Joker 為 {result.jokerValues.join(', ')} 時，總和為 {result.sum}
                                                    </>
                                                ) : (
                                                    <>總和為 {result.sum}</>
                                                )}
                                                {renderConversions(result.conversions, combo.remainingCards.cards)}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                selectedCards.length === mode && (
                    <div className="text-center py-4 text-gray-500">
                        沒有找到可以組成10倍數的組合
                    </div>
                )
            )}
        </div>
    )
}

export default PokerCalculator
