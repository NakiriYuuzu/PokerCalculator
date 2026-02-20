const STORAGE_KEY = 'poker-calculator:v2-preferences'

export const defaultPreferences = {
    rememberPreferences: true,
    mode: 3,
    rules: {
        enableThreeSixSwap: true,
        jokerWildcard: true,
        enableSpecialHands: {
            fiveSmallNiu: false,
            bombNiu: false,
            fiveFlowerNiu: false
        }
    }
}

const canUseStorage = () => typeof window !== 'undefined' && !!window.localStorage

export const loadPreferences = () => {
    if (!canUseStorage()) return defaultPreferences

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        if (!raw) return defaultPreferences
        const parsed = JSON.parse(raw)
        return {
            ...defaultPreferences,
            ...parsed,
            rules: {
                ...defaultPreferences.rules,
                ...(parsed.rules || {}),
                enableSpecialHands: {
                    ...defaultPreferences.rules.enableSpecialHands,
                    ...(parsed.rules?.enableSpecialHands || {})
                }
            }
        }
    } catch {
        return defaultPreferences
    }
}

export const savePreferences = (preferences) => {
    if (!canUseStorage()) return

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
    } catch {
        // 忽略儲存失敗（例如隱私模式）
    }
}

export const clearPreferences = () => {
    if (!canUseStorage()) return
    try {
        window.localStorage.removeItem(STORAGE_KEY)
    } catch {
        // 忽略
    }
}
