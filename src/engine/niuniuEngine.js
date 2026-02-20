export const DEFAULT_RULES = {
    enableThreeSixSwap: true,
    jokerWildcard: true,
    targetModulo: 10,
    enableSpecialHands: {
        fiveSmallNiu: false,
        bombNiu: false,
        fiveFlowerNiu: false
    }
}

export const CARD_VALUES = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'Joker']

export const createDeck = () => CARD_VALUES.map(value => ({
    value,
    display: value,
    numValue: value === 'A' ? 1 :
        ['J', 'Q', 'K'].includes(value) ? 10 :
            value === 'Joker' ? 'Joker' :
                parseInt(value)
}))

const getCardPossibleValues = (card, rules) => {
    if (rules.enableThreeSixSwap && card.value === '3') return [3, 6]
    if (rules.enableThreeSixSwap && card.value === '6') return [6, 3]
    return [card.numValue]
}

const generateValueCombinations = (cards, rules) => {
    const possibilities = cards.map(card => getCardPossibleValues(card, rules))
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
}

const calculateAllPossibleSums = (cards, rules) => {
    if (cards.length !== 3 && cards.length !== 2) return []

    const jokers = cards.filter(card => card.value === 'Joker')
    const nonJokers = cards.filter(card => card.value !== 'Joker')

    if (!rules.jokerWildcard && jokers.length > 0) {
        return []
    }

    const possibleValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    if (jokers.length === 0) {
        const valueCombinations = generateValueCombinations(cards, rules)
        return valueCombinations.map(combo => ({
            sum: combo.sum,
            jokerValues: [],
            isValid: cards.length === 3 ? combo.sum % rules.targetModulo === 0 : true,
            conversions: combo.conversions
        })).filter(result => cards.length === 2 || result.isValid)
    }

    const combinations = []
    const generateCombinations = (currentJokerIndex, currentSum, currentJokerValues, currentConversions) => {
        if (currentJokerIndex === jokers.length) {
            if (cards.length === 2 || currentSum % rules.targetModulo === 0) {
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

    const nonJokerCombinations = generateValueCombinations(nonJokers, rules)
    nonJokerCombinations.forEach(nonJokerCombo => {
        generateCombinations(0, nonJokerCombo.sum, [], nonJokerCombo.conversions)
    })

    return combinations
}

const getNiuRank = (sum) => {
    const niu = sum % 10
    return niu === 0 ? 10 : niu
}

const compareCandidates = (a, b) => {
    if (a.niuRank !== b.niuRank) return b.niuRank - a.niuRank
    if (a.jokerCount !== b.jokerCount) return a.jokerCount - b.jokerCount
    if (a.conversionCount !== b.conversionCount) return a.conversionCount - b.conversionCount
    return b.rawScore - a.rawScore
}

const resolveBest = (allCombos) => {
    const candidates = []

    allCombos.forEach((combo, comboIndex) => {
        if (!combo.remainingCards) {
            combo.results.forEach((result, resultIndex) => {
                const niuRank = getNiuRank(result.sum)
                candidates.push({
                    comboIndex,
                    resultIndex,
                    remainingResultIndex: null,
                    niuRank,
                    jokerCount: result.jokerValues.length,
                    conversionCount: result.conversions?.length || 0,
                    rawScore: result.sum
                })
            })
            return
        }

        combo.results.forEach((trioResult, resultIndex) => {
            combo.remainingCards.results.forEach((remainingResult, remainingResultIndex) => {
                const niuRank = getNiuRank(remainingResult.sum)
                candidates.push({
                    comboIndex,
                    resultIndex,
                    remainingResultIndex,
                    niuRank,
                    jokerCount: trioResult.jokerValues.length + remainingResult.jokerValues.length,
                    conversionCount: (trioResult.conversions?.length || 0) + (remainingResult.conversions?.length || 0),
                    rawScore: trioResult.sum + remainingResult.sum
                })
            })
        })
    })

    if (candidates.length === 0) return null
    candidates.sort(compareCandidates)
    const picked = candidates[0]
    return {
        ...picked,
        combo: allCombos[picked.comboIndex]
    }
}

export const evaluateSelection = (cards, mode, customRules = {}) => {
    const rules = {
        ...DEFAULT_RULES,
        ...customRules,
        enableSpecialHands: {
            ...DEFAULT_RULES.enableSpecialHands,
            ...(customRules.enableSpecialHands || {})
        }
    }

    if (!cards || cards.length !== mode) {
        return { all: [], best: null, rules }
    }

    if (mode === 3) {
        const possibleResults = calculateAllPossibleSums(cards, rules)
        const validResults = possibleResults.filter(result => result.isValid)

        const all = validResults.length > 0
            ? [{ cards, results: validResults, remainingCards: null }]
            : []

        return {
            all,
            best: resolveBest(all),
            rules
        }
    }

    if (mode === 5) {
        const all = []
        for (let i = 0; i < cards.length - 2; i++) {
            for (let j = i + 1; j < cards.length - 1; j++) {
                for (let k = j + 1; k < cards.length; k++) {
                    const combo = [cards[i], cards[j], cards[k]]
                    const remainingCards = cards.filter((_, index) =>
                        index !== i && index !== j && index !== k
                    )

                    const validResults = calculateAllPossibleSums(combo, rules)
                        .filter(result => result.isValid)

                    if (validResults.length > 0) {
                        const remainingResults = calculateAllPossibleSums(remainingCards, rules)
                        all.push({
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

        return {
            all,
            best: resolveBest(all),
            rules
        }
    }

    return { all: [], best: null, rules }
}
