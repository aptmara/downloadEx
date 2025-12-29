// Reading file to find handleSaveRule

/**
 * ルール管理クラス
 * データの保持、加工、ストレージとの同期を担当
 */
class RuleManager {
    constructor() {
        this.rules = [];
    }

    async loadRules() {
        try {
            const result = await chrome.storage.sync.get(['rules']);
            const loadedRules = result.rules || [];

            // データ整形とID/優先度の補完
            this.rules = loadedRules.map((rule, index) => ({
                ...rule,
                id: rule.id || (Date.now() + index + Math.floor(Math.random() * 10000)).toString(),
                matchType: rule.matchType || 'includes',
                priority: Number.isFinite(rule.priority) ? rule.priority : 0,
                enabled: rule.enabled !== undefined ? rule.enabled : true,
                targetType: rule.targetType || 'fileUrl',
                fileTypes: Array.isArray(rule.fileTypes) ? rule.fileTypes : [],
                enableDateSubfolder: rule.enableDateSubfolder === true,
            })).sort((a, b) => (b.priority || 0) - (a.priority || 0));

            return this.rules;
        } catch (error) {
            console.error('Failed to load rules:', error);
            throw error;
        }
    }

    async saveRules(newRules) {
        try {
            await chrome.storage.sync.set({ rules: newRules });
            this.rules = newRules;
        } catch (error) {
            console.error('Failed to save rules:', error);
            throw error;
        }
    }

    addRule(ruleData) {
        const priority = Number.isFinite(ruleData.priority)
            ? ruleData.priority
            : (this.rules.length > 0 ? Math.max(...this.rules.map(r => r.priority || 0)) + 1 : 0);

        const newRule = {
            ...ruleData,
            id: (Date.now() + Math.floor(Math.random() * 10000)).toString(),
            priority,
            enabled: true
        };

        // 正規表現チェック
        if (newRule.matchType === 'regex') {
            new RegExp(newRule.sitePattern); // エラーならここでthrowされる
        }

        const updatedRules = [...this.rules, newRule];
        return this.saveRules(updatedRules);
    }

    updateRule(id, ruleData) {
        const updatedRules = this.rules.map(rule => {
            if (rule.id.toString() === id.toString()) {
                // 優先度が入力されていない場合は既存を維持
                const priority = Number.isFinite(ruleData.priority) ? ruleData.priority : rule.priority;
                return { ...rule, ...ruleData, id: rule.id, priority };
            }
            return rule;
        });

        // 正規表現チェック
        if (ruleData.matchType === 'regex') {
            new RegExp(ruleData.sitePattern);
        }

        return this.saveRules(updatedRules);
    }

    deleteRule(id) {
        const updatedRules = this.rules.filter(rule => rule.id.toString() !== id.toString());
        return this.saveRules(updatedRules);
    }

    toggleRule(id, isEnabled) {
        const updatedRules = this.rules.map(rule =>
            rule.id.toString() === id.toString() ? { ...rule, enabled: isEnabled } : rule
        );
        return this.saveRules(updatedRules);
    }

    reorderRules(fromIndex, toIndex) {
        const movedRule = this.rules[fromIndex];
        const remainingRules = this.rules.filter((_, index) => index !== fromIndex);

        // 新しい位置に挿入
        remainingRules.splice(toIndex, 0, movedRule);

        // 優先度を再計算 (リストの上にあるほど優先度高く)
        const total = remainingRules.length;
        const updatedRules = remainingRules.map((rule, index) => ({
            ...rule,
            priority: total - 1 - index
        }));

        this.rules = updatedRules;
        return this.saveRules(updatedRules);
    }

    getRule(id) {
        return this.rules.find(r => r.id.toString() === id.toString());
    }

    findMatchingRule(downloadItem) {
        for (const rule of this.rules) {
            if (rule.enabled === false) continue;

            // マッチングロジック (Backgroudと共通)
            const targetUrl = (rule.targetType === 'pageUrl' && downloadItem.referrer)
                ? downloadItem.referrer
                : downloadItem.url;

            if (!targetUrl || !rule.sitePattern) continue;

            let isMatch = false;
            try {
                switch (rule.matchType) {
                    case 'exact':
                        isMatch = (targetUrl === rule.sitePattern);
                        break;
                    case 'regex':
                        const regex = new RegExp(rule.sitePattern, 'i');
                        isMatch = regex.test(targetUrl);
                        break;
                    case 'includes':
                    default:
                        isMatch = targetUrl.toLowerCase().includes(rule.sitePattern.toLowerCase());
                        break;
                }
            } catch (e) {
                console.error('Match checking error:', e);
                isMatch = false;
            }

            if (isMatch) {
                // ファイルタイプチェック
                if (rule.fileTypes && rule.fileTypes.length > 0) {
                    const ext = downloadItem.filename.split('.').pop().toLowerCase();
                    const ruleExts = rule.fileTypes.map(ft => ft.toLowerCase());
                    if (!ruleExts.includes(ext)) {
                        continue;
                    }
                }
                return rule;
            }
        }
        return null;
    }
}

/**
 * UI管理クラス
 * DOM操作、イベントハンドリングを担当
 */
class UIManager {
    constructor(ruleManager) {
        this.ruleManager = ruleManager;
        this.analyzer = new LogAnalyzer(); // Analyzer初期化

        // DOM Elements
        this.elements = {
            rulesListContainer: document.getElementById('rulesListContainer'),
            dashboard: document.getElementById('dashboard'), // ダッシュボード追加
            openAddRuleModalButton: document.getElementById('openAddRuleModalButton'),
            ruleFormModal: document.getElementById('ruleFormModal'),
            closeModalButton: document.getElementById('closeModalButton'),
            ruleForm: document.getElementById('ruleForm'),
            cancelRuleButton: document.getElementById('cancelRuleButton'),

            // Original form inputs, re-added for completeness based on original setupElements
            saveRuleButton: document.getElementById('saveRuleButton'),
            formTitle: document.getElementById('formTitle'),
            ruleIdInput: document.getElementById('ruleId'),
            sitePatternInput: document.getElementById('sitePattern'),
            matchTypeSelect: document.getElementById('matchType'),
            folderNameInput: document.getElementById('folderName'),
            priorityInput: document.getElementById('priority'),
            fileTypesContainer: document.getElementById('fileTypesContainer'),
            fileTypesInput: document.getElementById('fileTypesInput'),
            statusMessage: document.getElementById('statusMessage'),
            enableDateSubfolderInput: document.getElementById('enableDateSubfolder'),
            helpModal: document.getElementById('helpModal'),
            openHelpButton: document.getElementById('openHelpButton'),
            closeHelpButton: document.getElementById('closeHelpButton')
        };

        this.setupEventListeners();
    }

    setupEventListeners() {
        // Modal controls
        this.elements.openAddRuleModalButton.addEventListener('click', () => this.openModal(false));
        this.elements.closeModalButton.addEventListener('click', () => this.closeModal());
        this.elements.cancelRuleButton.addEventListener('click', () => this.closeModal());
        this.elements.ruleFormModal.addEventListener('click', e => {
            if (e.target === this.elements.ruleFormModal) this.closeModal();
        });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && this.elements.ruleFormModal.classList.contains('active')) this.closeModal();
        });

        // Form submission
        this.elements.ruleForm.addEventListener('submit', e => this.handleSaveRule(e));

        // Tag input
        this.setupTagInput();

        // Rule List Event Delegation (Edit, Delete, Toggle)
        this.elements.rulesListContainer.addEventListener('click', e => this.handleListClick(e));
        this.elements.rulesListContainer.addEventListener('change', e => this.handleListChange(e));

        // Drag and Drop
        this.setupDragAndDrop();
        // Test Rule
        const testBtn = document.getElementById('testRuleButton');
        if (testBtn) {
            testBtn.addEventListener('click', () => this.handleTestRule());
        }

        // Storage sync listener
        chrome.storage.onChanged.addListener((changes, namespace) => {
            if (namespace === 'sync' && changes.rules) {
                console.log('Reloading rules from storage change.');
                this.loadAndRender();
            }
        });
        // Expert Mode Toggle
        const expertModeToggle = document.getElementById('expertModeToggle');
        if (expertModeToggle) {
            // Load state
            chrome.storage.sync.get(['expertMode'], (result) => {
                const isExpert = result.expertMode === true;
                expertModeToggle.checked = isExpert;
                document.body.classList.toggle('simple-mode', !isExpert);
            });

            // Change event
            expertModeToggle.addEventListener('change', (e) => {
                const isExpert = e.target.checked;
                document.body.classList.toggle('simple-mode', !isExpert);
                chrome.storage.sync.set({ expertMode: isExpert });
            });
        }

        // Help Modal Controls
        if (this.elements.openHelpButton) {
            this.elements.openHelpButton.addEventListener('click', () => {
                this.elements.helpModal.classList.add('active');
            });
            this.elements.closeHelpButton.addEventListener('click', () => {
                this.elements.helpModal.classList.remove('active');
            });
            this.elements.helpModal.addEventListener('click', e => {
                if (e.target === this.elements.helpModal) {
                    this.elements.helpModal.classList.remove('active');
                }
            });
        }

        // Context Menu Draft Check
        this.checkDraftRule();
    }

    // New method to check for draft rules
    checkDraftRule() {
        chrome.storage.local.get(['draftRule'], (result) => {
            if (result.draftRule) {
                const { sitePattern, timestamp } = result.draftRule;
                // 1分以内のドラフトなら有効
                if (Date.now() - timestamp < 60000) {
                    // 少し待ってから開く（レンダリング待ち）
                    setTimeout(() => {
                        this.openModal(false, { sitePattern: sitePattern });
                        this.showStatus('コンテキストメニューからルールの下書きを作成しました。', 'success');
                    }, 300);
                }
                // 使用後は削除
                chrome.storage.local.remove('draftRule');
            }
        });
    }

    handleTestRule() {
        const urlInput = document.getElementById('testUrlInput');
        const resultDiv = document.getElementById('testResult');
        const url = urlInput.value.trim();

        if (!url) return;

        // 簡易的な擬似ダウンロードアイテムを作成
        const mockDownloadItem = {
            url: url,
            referrer: '',
            filename: url.split('/').pop() || 'file.dat',
            ruleTargetType: 'fileUrl' // デフォルト
        };

        const rule = this.ruleManager.findMatchingRule(mockDownloadItem);

        if (rule) {
            // フォルダ名シミュレーション
            let folderName = rule.folderName || '';

            // プレースホルダー置換ロジック (簡易版)
            const now = new Date();
            const year = now.getFullYear();
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            const day = now.getDate().toString().padStart(2, '0');

            let domain = 'unknown';
            try {
                if (url.startsWith('http') || url.startsWith('https')) {
                    domain = new URL(url).hostname;
                }
            } catch (e) { }

            folderName = folderName
                .replace(/{YYYY-MM-DD}/g, `${year}-${month}-${day}`)
                .replace(/{YYYY}/g, year)
                .replace(/{MM}/g, month)
                .replace(/{DD}/g, day)
                .replace(/{domain}/g, domain);

            folderName = folderName.replace(/[<>:"/\\|?*.]|\.\.|\.$/g, '_').trim(); // Sanitize

            const finalPath = folderName ? `${folderName}/${mockDownloadItem.filename}` : mockDownloadItem.filename;

            resultDiv.innerHTML = `
                <strong>マッチしました！</strong><br>
                適用ルール: ${this.escapeHTML(rule.sitePattern)} (ID: ${rule.id})<br>
                保存先予想: ${this.escapeHTML(finalPath)}
            `;
            resultDiv.className = 'test-result match';
        } else {
            resultDiv.innerHTML = 'どのルールにもマッチしませんでした。<br>デフォルトのダウンロードフォルダに保存されます。';
            resultDiv.className = 'test-result no-match';
        }
        resultDiv.style.display = 'block';
    }

    escapeHTML(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
    }

    setupTagInput() {
        const { fileTypesContainer, fileTypesInput } = this.elements;

        fileTypesContainer.addEventListener('click', (e) => {
            if (e.target !== fileTypesInput && !e.target.classList.contains('tag-close-btn')) {
                fileTypesInput.focus();
            }
        });

        fileTypesInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const tagText = fileTypesInput.value.trim();
                if (tagText) {
                    this.addTag(tagText);
                    fileTypesInput.value = '';
                }
            }
            if (e.key === 'Backspace' && fileTypesInput.value === '') {
                const tags = fileTypesContainer.querySelectorAll('.tag');
                if (tags.length > 0) {
                    tags[tags.length - 1].remove();
                }
            }
        });
    }

    addTag(text) {
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.textContent = text;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'tag-close-btn';
        closeBtn.innerHTML = '&times;';
        closeBtn.onclick = () => tag.remove();

        tag.appendChild(closeBtn);
        this.elements.fileTypesContainer.insertBefore(tag, this.elements.fileTypesInput);
    }

    clearTags() {
        this.elements.fileTypesContainer.querySelectorAll('.tag').forEach(tag => tag.remove());
    }

    setupDragAndDrop() {
        const container = this.elements.rulesListContainer;
        let draggedItem = null;

        container.addEventListener('dragstart', e => {
            if (e.target.closest('.rule-card')) {
                draggedItem = e.target.closest('.rule-card');
                setTimeout(() => draggedItem.classList.add('dragging'), 0);
            }
        });

        container.addEventListener('dragend', async () => {
            if (draggedItem) {
                draggedItem.classList.remove('dragging');

                // DOM上の新しい順序からインデックスを取得して保存
                const newOrderIds = [...container.querySelectorAll('.rule-card')].map(el => el.dataset.id);
                // 元のルールのIDリスト
                const oldOrderIds = this.ruleManager.rules.map(r => r.id.toString());

                // 変更検知 (簡易的)
                if (JSON.stringify(newOrderIds) !== JSON.stringify(oldOrderIds)) {
                    // 全体の再構築はコストが高いので、RuleManager側でソートし直して保存する
                    // ここではシンプルに、DOMの順序通りに優先度を再割り当てする一括更新を行う
                    const rulesMap = new Map(this.ruleManager.rules.map(r => [r.id.toString(), r]));
                    const total = newOrderIds.length;
                    const newRules = newOrderIds.map((id, index) => {
                        const r = rulesMap.get(id);
                        return { ...r, priority: total - 1 - index };
                    });

                    try {
                        await this.ruleManager.saveRules(newRules);
                        this.showStatus('優先順位を更新しました。', 'success');
                    } catch (e) {
                        this.showStatus('優先順位の更新に失敗しました。', 'error');
                        this.loadAndRender(); // 失敗したら元に戻す
                    }
                }
                draggedItem = null;
            }
        });

        container.addEventListener('dragover', e => {
            e.preventDefault();
            const afterElement = this.getDragAfterElement(container, e.clientY);
            const currentDraggable = document.querySelector('.dragging');
            if (currentDraggable) {
                if (afterElement == null) {
                    container.appendChild(currentDraggable);
                } else {
                    container.insertBefore(currentDraggable, afterElement);
                }
            }
        });
    }

    getDragAfterElement(container, y) {
        const draggableElements = [...container.querySelectorAll('.rule-card:not(.dragging)')];

        return draggableElements.reduce((closest, child) => {
            const box = child.getBoundingClientRect();
            const offset = y - box.top - box.height / 2;
            if (offset < 0 && offset > closest.offset) {
                return { offset: offset, element: child };
            } else {
                return closest;
            }
        }, { offset: Number.NEGATIVE_INFINITY }).element;
    }

    async loadAndRender() {
        try {
            await this.ruleManager.loadRules();
            this.renderRules();
        } catch (error) {
            this.showStatus('ルールの読み込みに失敗しました。', 'error');
        }
    }

    renderRules() {
        const { rulesListContainer } = this.elements;
        rulesListContainer.innerHTML = '';
        const rules = this.ruleManager.rules;

        if (rules.length === 0) {
            rulesListContainer.innerHTML = '<div style="text-align:center; color:var(--text-secondary); padding:2rem;">有効なルールがありません。「新規ルール」ボタンから作成してください。</div>';
            return;
        }

        const fragment = document.createDocumentFragment();

        rules.forEach(rule => {
            const item = document.createElement('div');
            item.className = 'rule-item';
            item.dataset.id = rule.id;
            item.setAttribute('draggable', 'true');

            // Info Section
            const infoDiv = document.createElement('div');
            infoDiv.className = 'rule-info';

            const title = document.createElement('h3');
            title.textContent = rule.sitePattern || '(未設定)';

            const meta = document.createElement('div');
            meta.className = 'rule-meta';
            const folderText = rule.folderName ? ` ➔ ${rule.folderName}` : ' ➔ (ルート)';
            const typesText = (rule.fileTypes && rule.fileTypes.length) ? ` [${rule.fileTypes.join(', ')}]` : '';

            let matchTypeStr = '部分一致';
            if (rule.matchType === 'exact') matchTypeStr = '完全一致';
            if (rule.matchType === 'regex') matchTypeStr = '正規表現';

            meta.textContent = `${matchTypeStr}${folderText}${typesText}`;

            infoDiv.append(title, meta);

            // Actions & Status
            const actionsDiv = document.createElement('div');
            actionsDiv.style.display = 'flex';
            actionsDiv.style.alignItems = 'center';
            actionsDiv.style.gap = '1rem';

            // Enabled Toggle (Mini)
            const toggleLabel = document.createElement('label');
            toggleLabel.className = 'switch-minimal';
            toggleLabel.style.transform = 'scale(0.8)'; // Make it smaller for the list

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'toggle-rule-enabled';
            checkbox.dataset.id = rule.id;
            checkbox.checked = rule.enabled !== false;

            const slider = document.createElement('span');
            slider.className = 'slider-minimal';

            toggleLabel.append(checkbox, slider);

            // Edit/Delete Buttons
            const editBtn = document.createElement('button');
            editBtn.className = 'btn-text btn-edit-rule';
            editBtn.dataset.id = rule.id;
            editBtn.textContent = '編集';

            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'btn-text btn-delete-rule';
            deleteBtn.dataset.id = rule.id;
            deleteBtn.textContent = '削除';
            deleteBtn.style.color = 'var(--danger-color)';

            actionsDiv.append(toggleLabel, editBtn, deleteBtn);
            item.append(infoDiv, actionsDiv);
            fragment.appendChild(item);
        });

        rulesListContainer.appendChild(fragment);
    }

    async handleSaveRule(event) {
        event.preventDefault();
        const { ruleIdInput, sitePatternInput, matchTypeSelect, folderNameInput, priorityInput, fileTypesContainer, enableDateSubfolderInput } = this.elements;

        const tags = Array.from(fileTypesContainer.querySelectorAll('.tag')).map(tag => tag.firstChild.textContent);
        const targetType = document.querySelector('input[name="targetType"]:checked').value;

        const ruleData = {
            sitePattern: sitePatternInput.value.trim(),
            matchType: matchTypeSelect.value,
            folderName: folderNameInput.value.trim(),
            priority: priorityInput.value ? parseInt(priorityInput.value, 10) : undefined,
            enabled: true,
            targetType: targetType,
            fileTypes: tags,
            enableDateSubfolder: enableDateSubfolderInput.checked
        };

        if (!ruleData.sitePattern) {
            this.showStatus('サイトパターンを入力してください。', 'error');
            return;
        }

        try {
            if (this.editingRuleId) {
                await this.ruleManager.updateRule(this.editingRuleId, ruleData);
                this.showStatus('ルールを更新しました。');
            } else {
                await this.ruleManager.addRule(ruleData);
                this.showStatus('ルールを作成しました。');
            }
            this.closeModal();
            this.loadAndRender();
        } catch (error) {
            console.error(error);
            this.showStatus('保存に失敗しました。正規表現を確認してください。', 'error');
        }
    }

    // Modal Control
    openModal(isEdit, ruleId = null) {
        this.elements.ruleForm.reset();
        this.clearTags();
        this.editingRuleId = isEdit ? ruleId : null;
        this.elements.formTitle.textContent = isEdit ? 'ルール編集' : '新規ルール';

        if (isEdit && ruleId) {
            const rule = this.ruleManager.getRule(ruleId);
            if (rule) {
                this.elements.ruleIdInput.value = rule.id;
                this.elements.sitePatternInput.value = rule.sitePattern || '';
                this.elements.matchTypeSelect.value = rule.matchType || 'includes';
                this.elements.folderNameInput.value = rule.folderName || '';
                this.elements.priorityInput.value = rule.priority;
                const targetType = rule.targetType || 'fileUrl';
                const targetRadio = document.querySelector(`input[name="targetType"][value="${targetType}"]`);
                if (targetRadio) targetRadio.checked = true;

                if (rule.fileTypes) {
                    rule.fileTypes.forEach(ft => this.addTag(ft));
                }
                this.elements.enableDateSubfolderInput.checked = rule.enableDateSubfolder === true;
            }
        } else {
            // Defaults
            this.elements.matchTypeSelect.value = 'includes';
            if (defaultRadio) defaultRadio.checked = true;
            this.elements.enableDateSubfolderInput.checked = false;
        }

        this.elements.ruleFormModal.classList.add('active');
        this.elements.sitePatternInput.focus();
    }

    closeModal() {
        this.elements.ruleFormModal.classList.remove('active');
        this.editingRuleId = null;
    }

    showStatus(message, type = 'success') {
        const el = this.elements.statusMessage;
        el.textContent = message;
        el.style.backgroundColor = type === 'error' ? 'var(--danger-color)' : 'var(--text-primary)';
        el.classList.add('visible');

        // Hide existing timeout if any
        if (this.statusTimeout) clearTimeout(this.statusTimeout);

        this.statusTimeout = setTimeout(() => {
            el.classList.remove('visible');
        }, 3000);
    }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    const ruleManager = new RuleManager();
    const uiManager = new UIManager(ruleManager);
    uiManager.loadAndRender();
});
