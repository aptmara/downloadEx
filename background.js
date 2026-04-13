// background.js

// --- Global Cache ---
let cachedRules = null;
let rulesPromise = null;

// Cache global state to avoid async calls on every download
/** @type {boolean} グローバル有効フラグ（同期読み込み失敗時は true をデフォルト） */
let globalEnabledCache = true;

// --- Storage Mirror Keys ---
/** storage.local に保存するミラーキー（storage.sync より高速） */
const LOCAL_MIRROR_RULES_KEY = '_mirror_rules';
const LOCAL_MIRROR_GLOBAL_ENABLED_KEY = '_mirror_globalEnabled';

/**
 * storage.sync の rules と globalEnabled を storage.local にミラーする
 * 呼び出し元: onInstalled / storage.onChanged
 * @param {object} syncData { rules?, globalEnabled? }
 * @returns {Promise<void>}
 */
const mirrorSyncToLocal = async (syncData) => {
    const toWrite = {};
    if ('rules' in syncData) {
        toWrite[LOCAL_MIRROR_RULES_KEY] = syncData.rules;
    }
    if ('globalEnabled' in syncData) {
        toWrite[LOCAL_MIRROR_GLOBAL_ENABLED_KEY] = syncData.globalEnabled;
    }
    if (Object.keys(toWrite).length > 0) {
        await chrome.storage.local.set(toWrite);
    }
};

// --- Initialization (後方に移動) ---
// processRules / mirrorSyncToLocal を参照するため、定義後に実行される

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
        // ドメイン解決: 呼び出し元(decideFilename)でcachedDomainが渡されるため
        // ここは安全なフォールバックとしてdownloadItem.urlを使用
        const sourceUrl = downloadItem.url;
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
            enableDateSubfolder: rule.enableDateSubfolder === true,

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
        return String(b.id || '').localeCompare(String(a.id || ''));
    });
};

// --- Initialization ---
// SW起動時: storage.local（ミラー）から高速プリロード
// storage.sync よりも桁違いに速いため、コールドスタート遅延を回避する
// ※ processRules / mirrorSyncToLocal の定義後に配置（constは巻き上げなし）
(async () => {
    const perfStart = performance.now();
    try {
        const localResult = await chrome.storage.local.get([
            LOCAL_MIRROR_RULES_KEY,
            LOCAL_MIRROR_GLOBAL_ENABLED_KEY
        ]);

        if (localResult[LOCAL_MIRROR_GLOBAL_ENABLED_KEY] !== undefined) {
            globalEnabledCache = localResult[LOCAL_MIRROR_GLOBAL_ENABLED_KEY];
        }

        if (localResult[LOCAL_MIRROR_RULES_KEY] !== undefined) {
            // ミラーが存在すれば即座にキャッシュを構築
            cachedRules = processRules(localResult[LOCAL_MIRROR_RULES_KEY]);
            console.log(`[DownloaderExt] Cold-start preload from local mirror: ${cachedRules.length} rules (${(performance.now() - perfStart).toFixed(1)}ms)`);
        } else {
            // ミラー未作成（初回インストール前）: storage.sync にフォールバック
            const syncResult = await chrome.storage.sync.get(['rules', 'globalEnabled']);
            if (syncResult.globalEnabled !== undefined) {
                globalEnabledCache = syncResult.globalEnabled;
            }
            cachedRules = processRules(syncResult.rules);
            // ミラーを作成して次回以降を高速化
            await mirrorSyncToLocal(syncResult);
            console.log(`[DownloaderExt] Cold-start preload from sync (no mirror yet): ${cachedRules.length} rules (${(performance.now() - perfStart).toFixed(1)}ms)`);
        }
    } catch (e) {
        console.error('[DownloaderExt] Cold-start preload error:', e);
        cachedRules = cachedRules ?? [];
    }
})();

/**
 * ルールを取得する (キャッシュ優先)
 * 強制リロード時は storage.local ミラー → storage.sync の順で試みる
 * @param {boolean} forceReload キャッシュを無視して再読み込みする
 */
const getRules = async (forceReload = false) => {
    if (cachedRules !== null && !forceReload) {
        return cachedRules;
    }

    if (rulesPromise && !forceReload) {
        return rulesPromise;
    }

    rulesPromise = (async () => {
        try {
            // storage.local ミラーを優先（高速）
            const localResult = await chrome.storage.local.get([LOCAL_MIRROR_RULES_KEY]);
            if (!forceReload && localResult[LOCAL_MIRROR_RULES_KEY] !== undefined) {
                cachedRules = processRules(localResult[LOCAL_MIRROR_RULES_KEY]);
                console.log(`[DownloaderExt] Rules loaded from local mirror: ${cachedRules.length}`);
                return cachedRules;
            }

            // forceReload または ミラーなし → storage.sync にフォールバック
            const syncResult = await chrome.storage.sync.get(['rules']);
            if (chrome.runtime.lastError) {
                console.error("[DownloaderExt] Rule load error:", chrome.runtime.lastError);
                cachedRules = cachedRules ?? [];
            } else {
                cachedRules = processRules(syncResult.rules);
                // ミラーを更新
                await mirrorSyncToLocal({ rules: syncResult.rules });
                console.log(`[DownloaderExt] Rules loaded from sync: ${cachedRules.length}`);
            }
        } catch (e) {
            console.error('[DownloaderExt] getRules error:', e);
            cachedRules = cachedRules ?? [];
        }
        return cachedRules;
    })();

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

// ストレージ変更監視
// storage.sync の変更を検知したら: (1) キャッシュ更新, (2) local ミラー更新
chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync') {
        const mirrorUpdate = {};
        if (changes.rules) {
            console.log("[DownloaderExt] Rules changed. Updating cache and mirror.");
            cachedRules = processRules(changes.rules.newValue);
            mirrorUpdate.rules = changes.rules.newValue;
        }
        if (changes.globalEnabled) {
            globalEnabledCache = changes.globalEnabled.newValue;
            mirrorUpdate.globalEnabled = changes.globalEnabled.newValue;
            console.log(`[DownloaderExt] Global enabled changed to: ${globalEnabledCache}`);
        }
        if (Object.keys(mirrorUpdate).length > 0) {
            mirrorSyncToLocal(mirrorUpdate);
        }
    }
});

// コンテキストメニュー処理
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (info.menuItemId === "create-rule-for-site") {
        // リンク上で右クリック → リンク先のドメイン
        // ページ上で右クリック → ページのドメイン
        const urlToUse = info.linkUrl || info.pageUrl;
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
        const initData = { rules: [], globalEnabled: true };
        await chrome.storage.sync.set(initData);
        // インストール直後に local ミラーも作成
        await mirrorSyncToLocal(initData);
        console.log("[DownloaderExt] Installed.");
    } else {
        // アップデート時: storage.sync から最新値を取得してミラーを更新
        const syncData = await chrome.storage.sync.get(['rules', 'globalEnabled']);
        await mirrorSyncToLocal(syncData);
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

        // URLマッチしなければ次のルールへ
        if (!isMatch) continue;

        // ファイルタイプ指定がある場合のみ拡張子チェック
        // 空配列 = 全ファイルタイプ対象なのでチェックをスキップ
        if (rule.lowerCaseFileTypes.length > 0) {
            if (!ext || !rule.lowerCaseFileTypes.includes(ext)) {
                continue;
            }
        }

        let folderName = rule.folderName || '';

        // 日付サブフォルダオプションが有効な場合、末尾に追加
        if (rule.enableDateSubfolder) {
            folderName = folderName ? `${folderName}/{YYYY-MM-DD}` : `{YYYY-MM-DD}`;
        }

        if (folderName.includes('{domain}') && !cachedDomain) {
            // マッチしたルールのtargetTypeに基づいてドメイン解決
            const sourceUrl = (rule.targetType === 'pageUrl' && downloadItem.referrer)
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
    // --- 性能計測: ダウンロード開始からsuggest()呼び出しまでの時間を計測 ---
    const _perfStart = performance.now();
    /** @param {'sync'|'async'} path どちらのパスを通ったか */
    const _logPerf = (path, matched) => {
        const elapsed = (performance.now() - _perfStart).toFixed(2);
        console.log(`[DownloaderExt] [PERF] onDeterminingFilename: path=${path}, matched=${matched}, elapsed=${elapsed}ms, file=${downloadItem.filename}`);
    };

    // 1. グローバル設定チェック (同期キャッシュ)
    if (globalEnabledCache === false) {
        _logPerf('sync', false);
        return; // 即座に終了 (デフォルト動作)
    }

    // 2. 高速パス: ルールがキャッシュされていれば同期的に処理
    // Promise生成とイベントループ遅延を完全に回避
    if (cachedRules !== null) {
        const result = decideFilename(downloadItem, cachedRules);
        _logPerf('sync', !!result);
        if (result) {
            suggest(result);
        }
        return; // return trueしない = 同期処理完了
    }

    // 3. コールドスタートパス: キャッシュ未初期化の場合のみ（起動直後の極めて稀なケース）
    // スクリプト最上位の非同期プリロードが完了する前にダウンロードが発生した場合のみ通る
    (async () => {
        const rules = await getRules();
        const result = decideFilename(downloadItem, rules);
        _logPerf('async', !!result);
        if (result) {
            suggest(result);
        }
    })();
    return true;
});
