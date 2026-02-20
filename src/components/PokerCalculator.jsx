import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createDeck, evaluateSelection } from '../engine/niuniuEngine'
import { clearPreferences, defaultPreferences, loadPreferences, savePreferences } from '../utils/preferences'
import CardBatchExtractor from './CardBatchExtractor'

const PokerCalculator = () => {
    const initialPreferences = useRef(loadPreferences()).current

    const [selectedCards, setSelectedCards] = useState([])
    const [combinations, setCombinations] = useState([])
    const [bestCombination, setBestCombination] = useState(null)
    const [mode, setMode] = useState(initialPreferences.mode || 3)
    const [cardCounts, setCardCounts] = useState({})

    const [enableThreeSixSwap, setEnableThreeSixSwap] = useState(
        initialPreferences.rules?.enableThreeSixSwap ?? true
    )
    const [jokerWildcard, setJokerWildcard] = useState(
        initialPreferences.rules?.jokerWildcard ?? true
    )
    const [rememberPreferences, setRememberPreferences] = useState(
        initialPreferences.rememberPreferences ?? true
    )

    const selectedCountRef = useRef(0)

    const deck = createDeck()

    useEffect(() => {
        selectedCountRef.current = selectedCards.length
    }, [selectedCards])

    useEffect(() => {
        if (!rememberPreferences) {
            clearPreferences()
            return
        }

        savePreferences({
            ...defaultPreferences,
            rememberPreferences,
            mode,
            rules: {
                ...defaultPreferences.rules,
                enableThreeSixSwap,
                jokerWildcard
            }
        })
    }, [rememberPreferences, mode, enableThreeSixSwap, jokerWildcard])

    const resetSelection = () => {
        setSelectedCards([])
        setCardCounts({})
        setCombinations([])
        setBestCombination(null)
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

    const handleBatchImport = useCallback((cardValues) => {
        const available = Math.max(0, mode - selectedCards.length)
        const cardsToAdd = []
        const countDelta = {}

        let added = 0
        let skipped = 0

        cardValues.forEach((cardValue) => {
            const card = deck.find(item => item.value === cardValue)
            if (!card) {
                skipped += 1
                return
            }

            if (cardsToAdd.length >= available) {
                skipped += 1
                return
            }

            cardsToAdd.push(card)
            countDelta[card.value] = (countDelta[card.value] || 0) + 1
            added += 1
        })

        if (cardsToAdd.length > 0) {
            setSelectedCards(prev => {
                const next = [...prev, ...cardsToAdd]
                selectedCountRef.current = next.length
                return next
            })

            setCardCounts(prev => {
                const merged = { ...prev }
                Object.entries(countDelta).forEach(([value, count]) => {
                    merged[value] = (merged[value] || 0) + count
                })
                return merged
            })
        }

        return { added, skipped }
    }, [deck, mode, selectedCards.length])

    useEffect(() => {
        if (selectedCards.length !== mode) {
            setCombinations([])
            setBestCombination(null)
            return
        }

        const { all, best } = evaluateSelection(selectedCards, mode, {
            enableThreeSixSwap,
            jokerWildcard
        })

        setCombinations(all)
        setBestCombination(best)
    }, [selectedCards, mode, enableThreeSixSwap, jokerWildcard])

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

    const renderBest = () => {
        if (!bestCombination) return null

        const combo = bestCombination.combo
        const mainResult = combo.results[bestCombination.resultIndex]
        const remainingResult = combo.remainingCards
            ? combo.remainingCards.results[bestCombination.remainingResultIndex]
            : null

        return (
            <div className="border rounded-lg p-4 mb-4 bg-amber-50 border-amber-300">
                <p className="font-semibold text-amber-800 mb-1">最優解（Beta）</p>
                <p className="text-sm text-amber-700 mb-2">
                    牛值：{bestCombination.niuRank === 10 ? '牛牛' : `牛${bestCombination.niuRank}`}
                </p>

                <p className="text-sm">
                    前三張：{combo.cards.map(c => c.display).join(', ')}
                    {mainResult && renderConversions(mainResult.conversions, combo.cards)}
                </p>

                {remainingResult && combo.remainingCards && (
                    <p className="text-sm mt-1">
                        後兩張：{combo.remainingCards.cards.map(c => c.display).join(', ')}
                        {renderConversions(remainingResult.conversions, combo.remainingCards.cards)}
                    </p>
                )}
            </div>
        )
    }

    return (
        <div className="max-w-4xl mx-auto p-4 bg-white rounded-lg shadow">
            <h2 className="text-xl font-bold mb-4">撲克牌計算器 v2（開發中）</h2>
            <div className="flex flex-col gap-2 mb-4">
                <p className="text-sm text-gray-600">牛牛核心重構中：已支援最優解 + 全部結果</p>

                <div className="flex flex-wrap items-center gap-4">
                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={enableThreeSixSwap}
                            onChange={(e) => setEnableThreeSixSwap(e.target.checked)}
                            className="rounded border-gray-300"
                        />
                        啟用 3/6 互換
                    </label>

                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={jokerWildcard}
                            onChange={(e) => setJokerWildcard(e.target.checked)}
                            className="rounded border-gray-300"
                        />
                        Joker 可作任意點數
                    </label>

                    <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                        <input
                            type="checkbox"
                            checked={rememberPreferences}
                            onChange={(e) => setRememberPreferences(e.target.checked)}
                            className="rounded border-gray-300"
                        />
                        記住我的設定（localStorage）
                    </label>
                </div>
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

            <CardBatchExtractor
                cardOptions={deck.map(card => card.value)}
                onImportCards={handleBatchImport}
                remainingSlots={Math.max(0, mode - selectedCards.length)}
            />

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

            {renderBest()}

            {combinations.length > 0 ? (
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold">全部可行組合：</h3>
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
                        沒有找到可行組合
                    </div>
                )
            )}
        </div>
    )
}

export default PokerCalculator
