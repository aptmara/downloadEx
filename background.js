// background.js

// --- Global Cache ---
let cachedRules = null;
let rulesPromise = null;

// Cache global state to avoid async calls on every download
let globalEnabledCache = true; // Default to true until loaded

// --- Initialization ---

// Initialize global state cache
chrome.storage.sync.get(['globalEnabled'], (result) => {
    if (result.globalEnabled !== undefined) {
        globalEnabledCache = result.globalEnabled;
    }
});

/**
 * 安全なフォルダ名に変換する
 * @param {string} folderName 
 * @returns {string}
 */
const sanitizeFolderName = (folderName) => {
    // 高速化: 型チェック簡略化 (呼び出し元で保証)
    return folderName.replace(/[<>:"/\\|?*.]|\.\.|\.$/g, '_').trim();
};

/**
 * ファイルの拡張子を取得する
 * @param {string} filename 
 * @returns {string} without dot
 */
const getFileExtension = (filename) => {
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1 || lastDot === 0 || lastDot === filename.length - 1) {
        return '';
    }
    return filename.substring(lastDot + 1).toLowerCase();
};

/**
 * プレースホルダーを置換する
 * @param {string} folderName 
 * @param {object} downloadItem 
 * @param {string} cachedDomain (Optional) 事前に計算済みのドメイン
 * @returns {string}
 */
const replacePlaceholders = (folderName, downloadItem, cachedDomain) => {
    if (!folderName) return '';

    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');

    let domain = cachedDomain || 'unknown';
    // cachedDomainが渡されず、かつdomainが必要な場合のみ計算
    if (!cachedDomain && folderName.includes('{domain}')) {
        const sourceUrl = (downloadItem.ruleTargetType === 'pageUrl' && downloadItem.referrer)
            ? downloadItem.referrer
            : downloadItem.url;
        try {
            if (sourceUrl && (sourceUrl.startsWith('http') || sourceUrl.startsWith('https'))) {
                domain = new URL(sourceUrl).hostname;
            }
        } catch (e) { }
    }

    return folderName
        .replace(/{YYYY-MM-DD}/g, `${year}-${month}-${day}`)
        .replace(/{YYYY}/g, year)
        .replace(/{MM}/g, month)
        .replace(/{DD}/g, day)
        .replace(/{domain}/g, domain);
};

/**
 * ルールにマッチするか判定する
 * @param {string} targetUrl 
 * @param {object} rule 
 * @returns {boolean}
 */
const matchesRule = (targetUrl, rule) => {
    // 空チェックは呼び出し元で行うとさらに高速だが、安全性のため残す
    if (!targetUrl || !rule.sitePattern) return false;

    // try-catchをループ内から排除（呼び出し元で制御、もしくは信頼する）
    // regexは事前コンパイル済み
    switch (rule.matchType) {
        case 'includes':
            // lowerCaseTargetUrlは呼び出し元で一回だけ生成して渡すがベストだが
            // 引数変更を避けるためここで小文字化 (少しコストあり)
            // 最適化: targetUrlLowerを引数に追加することも検討
            return targetUrl.toLowerCase().includes(rule.lowerCaseSitePatternForIncludes);
        case 'exact':
            return targetUrl === rule.sitePattern;
        case 'regex':
            return rule.compiledRegex ? rule.compiledRegex.test(targetUrl) : false;
        default:
            return false;
    }
};

/**
 * ルールを処理してキャッシュ可能な形式に変換する
 * メモリ使用量削減のため、実行時に必要なプロパティのみをホワイトリスト形式で保持する
 * @param {Array} rawRules 
 * @returns {Array}
 */
const processRules = (rawRules) => {
    const rules = rawRules || [];
    const processed = rules.map((rule, index) => {
        // メモリ最適化: 必要なプロパティのみを抽出してオブジェクトを作成
        // UI用のメタデータや余分なプロパティはキャッシュしない

        let fileTypesArray = [];
        if (Array.isArray(rule.fileTypes)) {
            fileTypesArray = rule.fileTypes;
        } else if (typeof rule.fileTypes === 'string' && rule.fileTypes) {
            fileTypesArray = rule.fileTypes.split(',').map(ft => ft.trim());
        }

        const compiledRegex = (rule.matchType === 'regex' && rule.sitePattern)
            ? (() => {
                try { return new RegExp(rule.sitePattern, 'i'); }
                catch (e) { console.error(`[DownloaderExt] Invalid Regex: ${rule.sitePattern}`); return null; }
            })()
            : null;

        const lowerCaseSitePattern = (rule.matchType === 'includes' && rule.sitePattern)
            ? rule.sitePattern.toLowerCase()
            : undefined;

        // ランタイム専用の軽量オブジェクト
        return {
            id: rule.id || Date.now() + index, // 数値/文字列はそのまま
            enabled: rule.enabled !== undefined ? rule.enabled : true,
            priority: Number.isFinite(parseInt(rule.priority)) ? parseInt(rule.priority) : 0,

            matchType: rule.matchType || 'includes',
            targetType: rule.targetType || 'fileUrl',

            sitePattern: rule.sitePattern || '', // ログ出力やExactマッチで必要
            folderName: rule.folderName || '',

            // 最適化: 判定に必要な小文字化済み配列のみ保持し、元の配列は破棄
            lowerCaseFileTypes: fileTypesArray
                .map(ft => typeof ft === 'string' ? ft.toLowerCase().trim() : '')
                .filter(ft => ft),

            compiledRegex: compiledRegex,
            lowerCaseSitePatternForIncludes: lowerCaseSitePattern
        };
    });

    // 優先度が高い順にソート (降順)
    return processed.sort((a, b) => {
        const priorityDiff = (b.priority || 0) - (a.priority || 0);
        if (priorityDiff !== 0) return priorityDiff;
        return (b.id || 0) - (a.id || 0);
    });
};

/**
 * ルールを取得する (キャッシュ優先)
 */
const getRules = async (forceReload = false) => {
    if (cachedRules && !forceReload) {
        return cachedRules;
    }

    if (rulesPromise && !forceReload) {
        return rulesPromise;
    }

    rulesPromise = new Promise((resolve) => {
        chrome.storage.sync.get(['rules'], (result) => {
            if (chrome.runtime.lastError) {
                console.error("[DownloaderExt] Rule load error:", chrome.runtime.lastError);
                cachedRules = [];
            } else {
                cachedRules = processRules(result.rules);
                console.log(`[DownloaderExt] Rules loaded: ${cachedRules.length}`);
            }
            resolve(cachedRules);
        });
    });

    try {
        await rulesPromise;
    } finally {
        rulesPromise = null;
    }

    return cachedRules;
};

// --- Log Batching System ---
// 書き込み頻度を下げるためのバッファ
const logBuffer = [];
let logFlushTimer = null;

const flushLogs = async () => {
    if (logBuffer.length === 0) return;

    try {
        const result = await chrome.storage.local.get(['activityLog']);
        let currentLogs = result.activityLog || [];

        // バッファの内容を全て追加
        // 配列の結合: 新しいもの(logBuffer) + 古いもの(currentLogs)
        const entriesToAdd = [...logBuffer]; // copy
        logBuffer.length = 0; // Clear buffer immediately

        // メモリ上で結合して50件に絞る
        const newLogs = entriesToAdd.concat(currentLogs).slice(0, 50);

        await chrome.storage.local.set({ activityLog: newLogs });
    } catch (e) {
        console.error('[DownloaderExt] Log flush error:', e);
    }
};

const saveLogDebounced = (logEntry) => {
    logBuffer.unshift(logEntry); // 最新を先頭に
    if (!logFlushTimer) {
        // 1秒後にフラッシュ
        logFlushTimer = setTimeout(() => {
            logFlushTimer = null;
            flushLogs();
        }, 1000);
    }
    // バッファが大きくなりすぎたら即時書き込み (安全弁)
    if (logBuffer.length > 10) {
        if (logFlushTimer) clearTimeout(logFlushTimer);
        logFlushTimer = null;
        flushLogs();
    }
};


// --- Event Listeners ---

// ストレージ変更監視を最適化
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        if (changes.rules) {
            console.log("[DownloaderExt] Rules changed. Updating cache.");
            getRules(true);
        }
        if (changes.globalEnabled) {
            globalEnabledCache = changes.globalEnabled.newValue;
            console.log(`[DownloaderExt] Global enabled changed to: ${globalEnabledCache}`);
        }
    }
});

// コンテキストメニュー処理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "create-rule-for-site") {
        const urlToUse = info.pageUrl;
        let sitePattern = "";
        try {
            sitePattern = new URL(urlToUse).hostname;
        } catch (e) {
            sitePattern = urlToUse;
        }

        await chrome.storage.local.set({
            draftRule: {
                sitePattern: sitePattern,
                timestamp: Date.now()
            }
        });
        chrome.runtime.openOptionsPage();
    }
});

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
        await chrome.storage.sync.set({ rules: [], globalEnabled: true });
        console.log("[DownloaderExt] Installed.");
    }

    // メニュー生成はonInstalledだけで十分（重複作成エラー回避）
    chrome.contextMenus.create({
        id: "create-rule-for-site",
        title: "DownloadEx: このサイトのルールを作成",
        contexts: ["page", "link"]
    });

    await getRules(true);
});

// --- Main Logic ---

/**
 * コアロジック: ルールを適用してファイル名を決定する
 * 同期・非同期の両方から呼ばれる
 * @param {object} downloadItem 
 * @param {Array} rules 
 * @returns {object|undefined} suggestに渡す結果
 */
const decideFilename = (downloadItem, rules) => {
    // 1. 必要な情報を抽出
    const ext = getFileExtension(downloadItem.filename);
    const urlLower = downloadItem.url ? downloadItem.url.toLowerCase() : '';
    const referrerLower = downloadItem.referrer ? downloadItem.referrer.toLowerCase() : '';

    let cachedDomain = null;

    // 2. ルールマッチング
    for (const rule of rules) {
        if (rule.enabled === false) continue;

        const targetUrl = (rule.targetType === 'pageUrl') ? downloadItem.referrer : downloadItem.url;
        if (!targetUrl) continue;

        let isMatch = false;
        try {
            if (rule.matchType === 'includes') {
                const targetLower = (rule.targetType === 'pageUrl') ? referrerLower : urlLower;
                if (targetLower && targetLower.includes(rule.lowerCaseSitePatternForIncludes)) {
                    isMatch = true;
                }
            } else {
                isMatch = matchesRule(targetUrl, rule);
            }
        } catch (e) { console.error(e); }

        if (isMatch) {
            if (rule.lowerCaseFileTypes && rule.lowerCaseFileTypes.length > 0) {
                if (!ext || !rule.lowerCaseFileTypes.includes(ext)) {
                    continue;
                }
            }

            let folderName = rule.folderName || '';
            if (folderName.includes('{domain}') && !cachedDomain) {
                const sourceUrl = (downloadItem.ruleTargetType === 'pageUrl' && downloadItem.referrer)
                    ? downloadItem.referrer
                    : downloadItem.url;
                try {
                    cachedDomain = new URL(sourceUrl).hostname;
                } catch (e) { cachedDomain = 'unknown'; }
            }

            folderName = replacePlaceholders(folderName, downloadItem, cachedDomain);
            const sanitizedFolderName = sanitizeFolderName(folderName);

            if (rule.folderName && !sanitizedFolderName) {
                continue;
            }

            const newFilename = sanitizedFolderName
                ? `${sanitizedFolderName}/${downloadItem.filename}`
                : downloadItem.filename;

            console.log(`[DownloaderExt] Matched Rule ID: ${rule.id} -> ${newFilename}`);

            // ログ保存 (常に非同期デバウンス)
            saveLogDebounced({
                timestamp: Date.now(),
                filename: downloadItem.filename,
                finalPath: newFilename,
                url: downloadItem.url,
                referrer: downloadItem.referrer,
                ruleId: rule.id,
                ruleName: rule.sitePattern,
                status: 'matched'
            });

            return { filename: newFilename, conflictAction: 'uniquify' };
        }
    }

    // マッチしなかった場合
    saveLogDebounced({
        timestamp: Date.now(),
        filename: downloadItem.filename,
        finalPath: downloadItem.filename,
        url: downloadItem.url,
        referrer: downloadItem.referrer,
        ruleId: null,
        status: 'no_match'
    });

    return undefined;
};

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    // 1. グローバル設定チェック (同期キャッシュ)
    if (globalEnabledCache === false) {
        return; // 即座に終了 (デフォルト動作)
    }

    // 2. 最適化パス: ルールがキャッシュされていれば同期的に処理
    // これによりPromise生成とイベントループ遅延を完全に回避
    if (cachedRules !== null) {
        const result = decideFilename(downloadItem, cachedRules);
        if (result) {
            suggest(result);
        } else {
            // suggest()を呼ばずにreturnするとデフォルト動作になるが
            // 明示的にコンフリクトアクション等を指定したい場合は呼ぶ
            // ここでは何も返さない = デフォルト
        }
        return; // return trueしない = 同期処理完了
    }

    // 3. コールドスタートパス: まだロードされていない場合は待機
    // ここだけ return true して非同期モードに入る
    (async () => {
        const rules = await getRules();
        const result = decideFilename(downloadItem, rules);
        suggest(result);
    })();
    return true;
});
