// background.js

let cachedRules = [];
let rulesCacheInitialized = false;

function sanitizeFolderName(folderName) {
    if (typeof folderName !== 'string') return '';
    return folderName.replace(/[<>:"/\\|?*.]|\.\.|\.$/g, '_').trim();
}

function replacePlaceholders(folderName, downloadItem) {
    if (typeof folderName !== 'string') return '';

    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');

    const sourceUrl = (downloadItem.ruleTargetType === 'pageUrl' && downloadItem.referrer)
                      ? downloadItem.referrer
                      : downloadItem.url;
    
    let domain = 'unknown';
    try {
        if(sourceUrl && (sourceUrl.startsWith('http') || sourceUrl.startsWith('https'))){
            domain = new URL(sourceUrl).hostname;
        }
    } catch (e) {
        console.warn(`[DownloaderExt] ドメイン名の取得に失敗: ${sourceUrl}`, e);
    }

    return folderName
        .replace(/{YYYY-MM-DD}/g, `${year}-${month}-${day}`)
        .replace(/{YYYY}/g, year)
        .replace(/{MM}/g, month)
        .replace(/{DD}/g, day)
        .replace(/{domain}/g, domain);
}

function matchesRule(downloadItem, rule) {
    const targetUrl = (rule.targetType === 'pageUrl' && downloadItem.referrer)
                      ? downloadItem.referrer
                      : downloadItem.url;

    if (!targetUrl || !rule.sitePattern) return false;
    
    const matchType = rule.matchType || 'includes';

    try {
        switch (matchType) {
            case 'exact':
                return targetUrl === rule.sitePattern;
            case 'regex':
                return rule.compiledRegex ? rule.compiledRegex.test(targetUrl) : false;
            case 'includes':
            default:
                return targetUrl.toLowerCase().includes(rule.lowerCaseSitePatternForIncludes);
        }
    } catch (e) {
        console.error(`正規表現エラー: Pattern="${rule.sitePattern}", Error="${e.message}"`);
        return false;
    }
}

function getFileExtension(filename) {
    if (typeof filename !== 'string') return '';
    const lastDot = filename.lastIndexOf('.');
    if (lastDot === -1 || lastDot === 0 || lastDot === filename.length - 1) {
        return '';
    }
    return filename.substring(lastDot + 1).toLowerCase();
}

async function loadAndCacheRules() {
    console.log("[DownloaderExt] ルールの読み込みとキャッシュを開始します...");
    try {
        const result = await new Promise(resolve => chrome.storage.sync.get(['rules'], resolve));
        let rulesToCache = result.rules || [];

        rulesToCache = rulesToCache.map((rule, index) => {
            let fileTypesArray = [];
            if (Array.isArray(rule.fileTypes)) {
                fileTypesArray = rule.fileTypes;
            } else if (typeof rule.fileTypes === 'string' && rule.fileTypes) {
                fileTypesArray = rule.fileTypes.split(',').map(ft => ft.trim());
            }

            const processedRule = {
                ...rule,
                id: rule.id || Date.now() + index + Math.floor(Math.random() * 10000),
                enabled: rule.enabled !== undefined ? rule.enabled : true,
                priority: Number.isFinite(parseInt(rule.priority)) ? parseInt(rule.priority) : 0,
                matchType: rule.matchType || 'includes',
                targetType: rule.targetType || 'fileUrl',
                fileTypes: fileTypesArray,
                lowerCaseFileTypes: fileTypesArray
                                     .map(ft => typeof ft === 'string' ? ft.toLowerCase().trim() : '')
                                     .filter(ft => ft),
            };

            if (processedRule.matchType === 'regex' && processedRule.sitePattern && typeof processedRule.sitePattern === 'string') {
                try {
                    processedRule.compiledRegex = new RegExp(processedRule.sitePattern, 'i');
                } catch (e) {
                    console.error(`[DownloaderExt] 無効な正規表現 "${processedRule.sitePattern}" のためコンパイル失敗:`, e.message);
                    processedRule.compiledRegex = null;
                }
            } else if (processedRule.matchType === 'includes' && processedRule.sitePattern && typeof processedRule.sitePattern === 'string') {
                processedRule.lowerCaseSitePatternForIncludes = processedRule.sitePattern.toLowerCase();
            }
            return processedRule;
        });

        rulesToCache.sort((a, b) => {
            const priorityDiff = (b.priority || 0) - (a.priority || 0);
            if (priorityDiff !== 0) {
                return priorityDiff;
            }
            return (b.id || 0) - (a.id || 0);
        });

        cachedRules = rulesToCache;
        rulesCacheInitialized = true;
        console.log(`[DownloaderExt] ルールがキャッシュされました: ${cachedRules.length} 件`);
    } catch (error) {
        console.error("[DownloaderExt] ルールの読み込みまたはキャッシュ中にエラーが発生しました:", error);
        cachedRules = [];
        rulesCacheInitialized = true;
    }
}

(async () => {
    await loadAndCacheRules();
})();

chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && changes.rules) {
        console.log("[DownloaderExt] ストレージ上のルールが変更されました。キャッシュを非同期で更新します。");
        loadAndCacheRules();
    }
});

chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    const process = async () => {
        if (!rulesCacheInitialized) {
            console.warn("[DownloaderExt] ルールキャッシュがまだ初期化されていません。初期化を待ってから処理します。");
            await loadAndCacheRules();
        }
        return processDownloadLogic(downloadItem);
    };

    suggest(process().catch(error => {
        console.error("[DownloaderExt] ダウンロード処理中にエラー:", error);
        return undefined;
    }));
    return true;
});

function processDownloadLogic(downloadItem) {
    for (const rule of cachedRules) {
        if (rule.enabled === false) {
            continue;
        }

        downloadItem.ruleTargetType = rule.targetType;

        if (matchesRule(downloadItem, rule)) {
            let fileTypeMatch = true;
            if (rule.lowerCaseFileTypes && rule.lowerCaseFileTypes.length > 0) {
                const downloadExtension = getFileExtension(downloadItem.filename);
                if (!downloadExtension || !rule.lowerCaseFileTypes.includes(downloadExtension)) {
                    fileTypeMatch = false;
                }
            }

            if (fileTypeMatch) {
                const folderName = rule.folderName || '';
                const replacedFolderName = replacePlaceholders(folderName, downloadItem);
                const sanitizedFolderName = sanitizeFolderName(replacedFolderName);

                if (folderName && !sanitizedFolderName) {
                    console.warn(`[DownloaderExt] ルール (ID: ${rule.id}) のフォルダ名 "${folderName}" が置換・サニタイズ後、空になりました。`);
                    continue; 
                }
                
                const newFilename = sanitizedFolderName
                    ? `${sanitizedFolderName}/${downloadItem.filename}`
                    : downloadItem.filename;

                const logFolderName = sanitizedFolderName || '(ルート)';
                console.log(`[DownloaderExt] ルール適用 (ID: ${rule.id}): "${rule.sitePattern}" -> "${logFolderName}/${downloadItem.filename}"`);
                
                return { filename: newFilename, conflictAction: 'uniquify' };
            }
        }
    }
    return undefined;
}

chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === "install") {
        await new Promise(resolve => chrome.storage.sync.set({ rules: [] }, resolve));
        console.log("[DownloaderExt] 拡張機能がインストールされました。初期ルールが空で設定されました。");
    } else if (details.reason === "update") {
        console.log("[DownloaderExt] 拡張機能がアップデートされました。");
    }
    await loadAndCacheRules();
    console.log("[DownloaderExt] インストール/アップデート処理が完了しました。");
});