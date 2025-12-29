class LogAnalyzer {
    constructor() {
        this.logs = [];
    }

    setLogs(logs) {
        this.logs = logs || [];
    }

    /**
     * ログを分析して、提案可能なルールを生成する
     * @returns {Array} 提案オブジェクトの配列
     */
    analyze() {
        if (this.logs.length === 0) return [];

        const noMatchLogs = this.logs.filter(log => log.status === 'no_match');
        if (noMatchLogs.length < 3) return []; // データ不足

        const suggestions = [];
        const domainCounts = {};

        // ドメインごとに集計
        for (const log of noMatchLogs) {
            let domain = this.getDomain(log.referrer || log.url);
            if (!domain) continue;

            if (!domainCounts[domain]) {
                domainCounts[domain] = { count: 0, extensions: {}, sampleFilename: log.filename };
            }
            domainCounts[domain].count++;

            const ext = this.getExtension(log.filename);
            if (ext) {
                domainCounts[domain].extensions[ext] = (domainCounts[domain].extensions[ext] || 0) + 1;
            }
        }

        // 提案生成ロジック
        for (const [domain, data] of Object.entries(domainCounts)) {
            // 3回以上同じドメインからダウンロードしている場合
            if (data.count >= 3) {
                const topExt = this.getTopExtension(data.extensions);
                const folderName = `${domain.replace(/\./g, '_')}_Files`; // 例: example_com_Files

                suggestions.push({
                    type: 'frequent_domain',
                    title: '頻繁に利用するサイト',
                    message: `${domain} から ${data.count} 回ダウンロードされています。専用フォルダにまとめますか？`,
                    ruleData: {
                        sitePattern: domain,
                        matchType: 'includes',
                        targetType: 'pageUrl',
                        folderName: folderName,
                        fileTypes: topExt ? [topExt] : [],
                        enabled: true
                    }
                });
            }
        }

        return suggestions;
    }

    getDomain(url) {
        try {
            if (!url) return null;
            if (!url.startsWith('http')) return null;
            return new URL(url).hostname;
        } catch (e) {
            return null;
        }
    }

    getExtension(filename) {
        return filename.split('.').pop().toLowerCase();
    }

    getTopExtension(extMap) {
        let max = 0;
        let top = null;
        for (const [ext, count] of Object.entries(extMap)) {
            if (count > max) {
                max = count;
                top = ext;
            }
        }
        return top;
    }
}
