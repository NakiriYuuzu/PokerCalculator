import React, { useState, useEffect, useCallback } from 'react'

const PokerCalculator = () => {
    const [selectedCards, setSelectedCards] = useState([]);
    const [combinations, setCombinations] = useState([]);
    const [mode, setMode] = useState(3);
    const [cardCounts, setCardCounts] = useState({});

    const values = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'Joker'];
    const deck = values.map(value => ({
        value,
        display: value,
        numValue: value === 'A' ? 1 :
            ['J', 'Q', 'K'].includes(value) ? 10 :
                value === 'Joker' ? 'Joker' :
                    parseInt(value)
    }));

    const resetSelection = () => {
        setSelectedCards([]);
        setCardCounts({});
        setCombinations([]);
    };

    // 計算單張牌的所有可能值（考慮3和6的互換）
    const getCardPossibleValues = useCallback((card) => {
        if (card.value === '3') return [3, 6];
        if (card.value === '6') return [6, 3];
        return [card.numValue];
    }, []);

    // 生成所有可能的數值組合
    const generateValueCombinations = useCallback((cards) => {
        const possibilities = cards.map(getCardPossibleValues);
        const results = [];

        const generate = (index, currentSum, currentValues, conversions) => {
            if (index === cards.length) {
                results.push({sum: currentSum, values: [...currentValues], conversions: [...conversions]});
                return;
            }

            possibilities[index].forEach(value => {
                const originalValue = cards[index].numValue;
                const conversion = (originalValue === 3 && value === 6) ||
                (originalValue === 6 && value === 3)
                    ? {index, from: originalValue, to: value}
                    : null;

                generate(
                    index + 1,
                    currentSum + value,
                    [...currentValues, value],
                    conversion ? [...conversions, conversion] : conversions
                );
            });
        };

        generate(0, 0, [], []);
        return results;
    }, [getCardPossibleValues]);

    const calculateAllPossibleSums = useCallback((cards) => {
        if (cards.length !== 3 && cards.length !== 2) return [];

        const jokers = cards.filter(card => card.value === 'Joker');
        const nonJokers = cards.filter(card => card.value !== 'Joker');
        const possibleValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

        if (jokers.length === 0) {
            // 生成所有可能的數值組合（考慮3和6的互換）
            const valueCombinations = generateValueCombinations(cards);
            return valueCombinations.map(combo => ({
                sum: combo.sum,
                jokerValues: [],
                isValid: cards.length === 3 ? combo.sum % 10 === 0 : true,
                conversions: combo.conversions
            })).filter(result => cards.length === 2 || result.isValid);
        }

        const combinations = [];
        const generateCombinations = (currentJokerIndex, currentSum, currentJokerValues, currentConversions) => {
            if (currentJokerIndex === jokers.length) {
                if (cards.length === 2 || currentSum % 10 === 0) {
                    combinations.push({
                        sum: currentSum,
                        jokerValues: [...currentJokerValues],
                        isValid: true,
                        conversions: currentConversions
                    });
                }
                return;
            }

            for (const value of possibleValues) {
                generateCombinations(
                    currentJokerIndex + 1,
                    currentSum + value,
                    [...currentJokerValues, value],
                    currentConversions
                );
            }
        };

        // 先計算非Joker牌的所有可能組合
        const nonJokerCombinations = generateValueCombinations(nonJokers);

        // 對每種非Joker牌的組合，計算加入Joker後的所有可能性
        nonJokerCombinations.forEach(nonJokerCombo => {
            generateCombinations(0, nonJokerCombo.sum, [], nonJokerCombo.conversions);
        });

        return combinations;
    }, [generateValueCombinations]);

    useEffect(() => {
        if (selectedCards.length === mode) {
            if (mode === 3) {
                const possibleResults = calculateAllPossibleSums(selectedCards);
                if (possibleResults.some(result => result.isValid)) {
                    setCombinations([{
                        cards: selectedCards,
                        results: possibleResults.filter(result => result.isValid),
                        remainingCards: null
                    }]);
                } else {
                    setCombinations([]);
                }
            } else if (mode === 5) {
                const allCombos = [];
                for (let i = 0; i < selectedCards.length - 2; i++) {
                    for (let j = i + 1; j < selectedCards.length - 1; j++) {
                        for (let k = j + 1; k < selectedCards.length; k++) {
                            const combo = [selectedCards[i], selectedCards[j], selectedCards[k]];
                            const remainingCards = selectedCards.filter((_, index) =>
                                index !== i && index !== j && index !== k
                            );
                            const possibleResults = calculateAllPossibleSums(combo);
                            const validResults = possibleResults.filter(result => result.isValid);

                            if (validResults.length > 0) {
                                const remainingResults = calculateAllPossibleSums(remainingCards);
                                allCombos.push({
                                    cards: combo,
                                    results: validResults,
                                    remainingCards: {
                                        cards: remainingCards,
                                        results: remainingResults
                                    }
                                });
                            }
                        }
                    }
                }
                setCombinations(allCombos);
            }
        } else {
            setCombinations([]);
        }
    }, [selectedCards, mode, calculateAllPossibleSums]);

    const handleCardSelect = (card) => {
        if (selectedCards.length < mode) {
            const newSelectedCards = [...selectedCards, card];
            setSelectedCards(newSelectedCards);
            setCardCounts(prev => ({
                ...prev,
                [card.value]: (prev[card.value] || 0) + 1
            }));
        }
    };

    const handleCardRemove = (index) => {
        const removedCard = selectedCards[index];
        setSelectedCards(selectedCards.filter((_, i) => i !== index));
        setCardCounts(prev => ({
            ...prev,
            [removedCard.value]: prev[removedCard.value] - 1
        }));
    };

    // 顯示轉換資訊的輔助函數
    const renderConversions = (conversions, cards) => {
        if (!conversions || conversions.length === 0) return null;

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
        );
    };

    return (
        <div className="max-w-4xl mx-auto p-4 bg-white rounded-lg shadow">
            <h2 className="text-xl font-bold mb-4">撲克牌計算器 (可重複選擇)</h2>
            <p className="text-sm text-gray-600 mb-2">特殊規則：3可以當作6，6可以當作3</p>
            <div className="space-x-2 mb-4">
                <button
                    className={`px-4 py-2 rounded ${mode === 3 ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    onClick={() => {
                        setMode(3);
                        resetSelection();
                    }}
                >
                    選擇3張
                </button>
                <button
                    className={`px-4 py-2 rounded ${mode === 5 ? 'bg-blue-500 text-white' : 'bg-gray-200'}`}
                    onClick={() => {
                        setMode(5);
                        resetSelection();
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
                        } ${['3', '6'].includes(card.value) ? 'border-blue-300' : ''}`}
                        onClick={() => handleCardSelect(card)}
                        disabled={selectedCards.length >= mode}
                    >
                        <span>{card.display}</span>
                        {cardCounts[card.value] > 0 && (
                            <span
                                className="absolute top-0 right-0 -mt-2 -mr-2 bg-blue-500 text-white rounded-full w-5 h-5 text-xs flex items-center justify-center">
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
                                                    當 Joker 為 {result.jokerValues.join(', ')} 時，
                                                    總和為 {result.sum}
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
                                                        當 Joker 為 {result.jokerValues.join(', ')} 時，
                                                        總和為 {result.sum}
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
    );
};

export default PokerCalculator;