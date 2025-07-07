// options.js

document.addEventListener('DOMContentLoaded', () => {
    // モーダル関連要素
    const ruleFormModal = document.getElementById('ruleFormModal');
    const openAddRuleModalButton = document.getElementById('openAddRuleModalButton');
    const cancelRuleButton = document.getElementById('cancelRuleButton');
    const closeModalButton = document.getElementById('closeModalButton');
    const formTitle = document.getElementById('formTitle');
    const ruleForm = document.getElementById('ruleForm');

    // フォーム入力要素
    const ruleIdInput = document.getElementById('ruleId');
    const sitePatternInput = document.getElementById('sitePattern');
    const matchTypeSelect = document.getElementById('matchType');
    const folderNameInput = document.getElementById('folderName');
    const priorityInput = document.getElementById('priority');
    const fileTypesContainer = document.getElementById('fileTypesContainer');
    const fileTypesInput = document.getElementById('fileTypesInput');
    
    const rulesListContainer = document.getElementById('rulesListContainer');
    const statusMessageDiv = document.getElementById('statusMessage');

    let rules = [];
    let editingRuleId = null;

    // XSS対策用のHTMLエスケープ関数
    function escapeHTML(str) {
        if (typeof str !== 'string') return '';
        return str.replace(/[&<>"']/g, match => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[match]));
    }
    
    // --- タグ入力UIの制御 ---
    function setupTagInput() {
        fileTypesContainer.addEventListener('click', () => {
            fileTypesInput.focus();
        });

        fileTypesInput.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ',') {
                e.preventDefault();
                const tagText = fileTypesInput.value.trim();
                if (tagText) {
                    addTag(tagText);
                    fileTypesInput.value = '';
                }
            }
        });
    }

    function addTag(text) {
        const tag = document.createElement('div');
        tag.className = 'tag';
        tag.textContent = text;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'tag-close-btn';
        closeBtn.innerHTML = '&times;';
        closeBtn.setAttribute('aria-label', `Remove ${text}`);
        closeBtn.onclick = () => {
            tag.remove();
        };

        tag.appendChild(closeBtn);
        fileTypesContainer.insertBefore(tag, fileTypesInput);
    }

    function clearTags() {
        fileTypesContainer.querySelectorAll('.tag').forEach(tag => tag.remove());
    }

    // --- モーダル制御 ---
    function openModal(isEdit = false, ruleToEdit = null) {
        ruleForm.reset();
        clearTags();
        
        formTitle.textContent = isEdit ? 'ルールを編集' : 'ルールを新規追加';
        editingRuleId = isEdit && ruleToEdit ? ruleToEdit.id : null;
        ruleIdInput.value = editingRuleId || '';

        if (isEdit && ruleToEdit) {
            sitePatternInput.value = ruleToEdit.sitePattern || '';
            matchTypeSelect.value = ruleToEdit.matchType || 'includes';
            folderNameInput.value = ruleToEdit.folderName || '';
            priorityInput.value = ruleToEdit.priority || 0;
            const targetType = ruleToEdit.targetType || 'fileUrl';
            document.querySelector(`input[name="targetType"][value="${targetType}"]`).checked = true;
            if (Array.isArray(ruleToEdit.fileTypes)) {
                ruleToEdit.fileTypes.forEach(ft => addTag(ft));
            }
        } else {
            matchTypeSelect.value = 'includes';
            priorityInput.value = ''; // 新規追加時は空にしておく
            document.getElementById('targetTypeFile').checked = true;
        }
        
        ruleFormModal.classList.add('active');
        document.body.classList.add('modal-active');
        sitePatternInput.focus();
    }

    function closeModal() {
        ruleFormModal.classList.remove('active');
        document.body.classList.remove('modal-active');
        editingRuleId = null;
    }

    openAddRuleModalButton.addEventListener('click', () => openModal(false));
    closeModalButton.addEventListener('click', closeModal);
    cancelRuleButton.addEventListener('click', closeModal);
    ruleFormModal.addEventListener('click', e => { if (e.target === ruleFormModal) closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && ruleFormModal.classList.contains('active')) closeModal(); });

    // --- ルール表示 ---
    function displayRules() {
        rulesListContainer.innerHTML = ''; 

        const sortedRules = [...rules].sort((a, b) => (b.priority || 0) - (a.priority || 0));

        if (sortedRules.length === 0) {
            rulesListContainer.innerHTML = '<p class="no-rules-message">まだルールがありません。「新しいルールを追加」ボタンから作成してください。</p>';
            return;
        }

        sortedRules.forEach(rule => {
            const sitePatternDisplay = rule.sitePattern ? escapeHTML(rule.sitePattern) : '(未設定)';
            const folderNameDisplay = rule.folderName ? escapeHTML(rule.folderName) : '(ルート)';
            const fileTypesDisplay = Array.isArray(rule.fileTypes) && rule.fileTypes.length > 0 ? escapeHTML(rule.fileTypes.join(', ')) : '(全タイプ)';
            let matchTypeFriendly = '部分一致';
            if (rule.matchType === 'exact') matchTypeFriendly = '完全一致';
            if (rule.matchType === 'regex') matchTypeFriendly = '正規表現';
            const targetTypeDisplay = rule.targetType === 'pageUrl' ? 'ページURL' : 'ファイルURL';

            const ruleCardHTML = `
                <div class="rule-card" data-id="${rule.id}" draggable="true">
                    <div class="rule-card-header">
                        <h3>${sitePatternDisplay}</h3>
                        <div class="toggle-switch">
                            <span class="status-text">${rule.enabled !== false ? '有効' : '無効'}</span>
                            <div class="toggle-checkbox-container">
                                <input type="checkbox" id="toggle-${rule.id}" class="toggle-checkbox toggle-rule-enabled" data-id="${rule.id}" ${rule.enabled !== false ? 'checked' : ''}>
                                <label for="toggle-${rule.id}" class="toggle-label"></label>
                            </div>
                        </div>
                    </div>
                    <div class="rule-card-body">
                        <p><strong>保存先フォルダ:</strong> ${folderNameDisplay}</p>
                        <p><strong>ファイルタイプ:</strong> ${fileTypesDisplay}</p>
                        <p><strong>マッチ種別:</strong> ${matchTypeFriendly}</p>
                        <p><strong>判定ターゲット:</strong> ${targetTypeDisplay}</p>
                    </div>
                    <div class="rule-card-footer">
                        <span class="priority-display">優先度: ${rule.priority || 0}</span>
                        <div class="rule-actions">
                            <button class="btn-icon btn-edit-rule" data-id="${rule.id}" title="編集">
                                <svg class="icon" viewBox="0 0 20 20" fill="currentColor"><path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z"></path><path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd"></path></svg>
                            </button>
                            <button class="btn-icon btn-delete-rule" data-id="${rule.id}" title="削除">
                                <svg class="icon" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd"></path></svg>
                            </button>
                        </div>
                    </div>
                </div>
            `;
            rulesListContainer.insertAdjacentHTML('beforeend', ruleCardHTML);
        });

        addEventListenersToRuleCards();
    }
    
    function addEventListenersToRuleCards() {
        document.querySelectorAll('.btn-edit-rule').forEach(button => button.addEventListener('click', e => handleEditRule(e.currentTarget.dataset.id)));
        document.querySelectorAll('.btn-delete-rule').forEach(button => button.addEventListener('click', e => handleDeleteRule(e.currentTarget.dataset.id)));
        document.querySelectorAll('.toggle-rule-enabled').forEach(toggle => toggle.addEventListener('change', e => handleToggleRuleEnabled(e.currentTarget.dataset.id, e.currentTarget.checked)));
    }

    // --- ドラッグ＆ドロップのロジック ---
    function setupDragAndDrop() {
        let draggedItem = null;

        rulesListContainer.addEventListener('dragstart', e => {
            if (e.target.classList.contains('rule-card')) {
                draggedItem = e.target;
                setTimeout(() => e.target.classList.add('dragging'), 0);
            }
        });

        rulesListContainer.addEventListener('dragend', () => {
            if (draggedItem) {
                draggedItem.classList.remove('dragging');
                draggedItem = null;
            }
        });
        
        rulesListContainer.addEventListener('dragover', e => {
            e.preventDefault();
            const afterElement = getDragAfterElement(rulesListContainer, e.clientY);
            const currentDraggable = document.querySelector('.dragging');
            if (afterElement == null) {
                rulesListContainer.appendChild(currentDraggable);
            } else {
                rulesListContainer.insertBefore(currentDraggable, afterElement);
            }
        });

        rulesListContainer.addEventListener('drop', e => {
            e.preventDefault();
            if (draggedItem) {
                draggedItem.classList.remove('dragging');
                draggedItem = null;
                updatePrioritiesAfterDrag();
            }
        });
    }

    function getDragAfterElement(container, y) {
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

    async function updatePrioritiesAfterDrag() {
        const ruleCards = rulesListContainer.querySelectorAll('.rule-card');
        const totalRules = ruleCards.length;
        const updatedRules = [...rules];

        ruleCards.forEach((card, index) => {
            const ruleId = card.dataset.id;
            const newPriority = totalRules - 1 - index;
            const ruleToUpdate = updatedRules.find(r => r.id.toString() === ruleId);
            if (ruleToUpdate) ruleToUpdate.priority = newPriority;
        });
        
        try {
            await chrome.storage.sync.set({ rules: updatedRules });
            rules = updatedRules;
            displayRules();
            showStatusMessage('優先順位を更新しました。', 'success');
        } catch (error) {
            console.error('優先順位の更新に失敗:', error);
            showStatusMessage(`優先順位の更新に失敗しました: ${error.message}`, 'error');
        }
    }

    // --- CRUD操作 ---
    async function handleSaveRule(event) {
        event.preventDefault(); 
        
        const id = editingRuleId || (Date.now() + Math.floor(Math.random() * 10000)).toString();
        const sitePattern = sitePatternInput.value.trim();
        const matchType = matchTypeSelect.value;
        const folderName = folderNameInput.value.trim();
        const fileTypes = [...fileTypesContainer.querySelectorAll('.tag')].map(tag => tag.firstChild.textContent);
        const priorityInputVal = parseInt(priorityInput.value, 10);
        let priority;

        if (!isNaN(priorityInputVal)) {
            priority = priorityInputVal;
        } else if (!editingRuleId) {
            priority = rules.length > 0 ? Math.max(...rules.map(r => r.priority || 0)) + 1 : 0;
        } else {
            priority = rules.find(r => r.id === editingRuleId).priority;
        }

        const targetType = document.querySelector('input[name="targetType"]:checked').value;

        if (!sitePattern) {
            showStatusMessage('サイトパターンは必須です。', 'error');
            sitePatternInput.focus();
            return;
        }

        const newRule = { 
            id, sitePattern, matchType, folderName, fileTypes, priority, targetType,
            enabled: editingRuleId ? rules.find(r => r.id.toString() === editingRuleId)?.enabled !== false : true
        };

        if (newRule.matchType === 'regex') {
            try {
                new RegExp(newRule.sitePattern);
            } catch (e) {
                showStatusMessage(`正規表現が無効です: ${e.message}`, 'error');
                sitePatternInput.focus();
                return;
            }
        }

        let updatedRules;
        if (editingRuleId) {
            updatedRules = rules.map(rule => (rule.id.toString() === editingRuleId ? newRule : rule));
        } else {
            updatedRules = [...rules, newRule];
        }

        try {
            await chrome.storage.sync.set({ rules: updatedRules });
            rules = updatedRules; 
            displayRules();
            closeModal();
            showStatusMessage(editingRuleId ? 'ルールを更新しました。' : '新しいルールを追加しました。', 'success');
        } catch (error) {
            console.error('ルールの保存に失敗:', error);
            showStatusMessage(`ルールの保存に失敗しました: ${error.message}`, 'error');
        }
        editingRuleId = null; 
    }

    ruleForm.addEventListener('submit', handleSaveRule);

    function handleEditRule(ruleId) {
        const ruleToEdit = rules.find(r => r.id.toString() === ruleId);
        if (ruleToEdit) openModal(true, ruleToEdit);
    }

    async function handleDeleteRule(ruleId) {
        if (!confirm('このルールを本当に削除しますか？')) return;

        const updatedRules = rules.filter(rule => rule.id.toString() !== ruleId);
        try {
            await chrome.storage.sync.set({ rules: updatedRules });
            rules = updatedRules;
            displayRules();
            showStatusMessage('ルールを削除しました。', 'success');
        } catch (error) {
            console.error('ルールの削除に失敗:', error);
            showStatusMessage(`ルールの削除に失敗しました: ${error.message}`, 'error');
        }
    }

    async function handleToggleRuleEnabled(ruleId, isEnabled) {
        const updatedRules = rules.map(rule => (rule.id.toString() === ruleId ? { ...rule, enabled: isEnabled } : rule));
        try {
            await chrome.storage.sync.set({ rules: updatedRules });
            rules = updatedRules;
            const card = document.querySelector(`.rule-card[data-id="${ruleId}"]`);
            if (card) {
                const statusText = card.querySelector('.status-text');
                if (statusText) statusText.textContent = isEnabled ? '有効' : '無効';
            }
            showStatusMessage(`ルールを${isEnabled ? '有効' : '無効'}にしました。`, 'success');
        } catch (error) {
            console.error('状態の更新に失敗:', error);
            showStatusMessage(`状態の更新に失敗しました: ${error.message}`, 'error');
        }
    }

    // --- 初期化処理 ---
    async function loadRules() {
        try {
            const result = await chrome.storage.sync.get(['rules']);
            const loadedRules = result.rules || [];
            
            rules = loadedRules.map((rule, index) => ({
                ...rule,
                id: rule.id || (Date.now() + index + Math.floor(Math.random() * 10000)).toString(),
                matchType: rule.matchType || 'includes',
                priority: rule.priority || 0,
                enabled: rule.enabled !== undefined ? rule.enabled : true,
                targetType: rule.targetType || 'fileUrl',
            }));

            displayRules();
        } catch (error) {
            console.error('ルールの読み込みに失敗:', error);
            showStatusMessage(`ルールの読み込みに失敗しました: ${error.message}`, 'error');
        }
    }

    function showStatusMessage(message, type = 'success') {
        statusMessageDiv.textContent = message;
        statusMessageDiv.className = '';
        statusMessageDiv.classList.add(type); 
        statusMessageDiv.style.display = 'block'; 
        statusMessageDiv.setAttribute('aria-live', 'assertive');
        setTimeout(() => {
            statusMessageDiv.style.display = 'none'; 
            statusMessageDiv.className = '';
            statusMessageDiv.removeAttribute('aria-live');
        }, 4000);
    }

    // 初期ロード
    loadRules();
    setupTagInput();
    setupDragAndDrop();

    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'sync' && changes.rules) {
            console.log('ストレージのルールが変更されたため再読み込みします。');
            loadRules();
        }
    });
});