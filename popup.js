document.addEventListener('DOMContentLoaded', () => {
    const globalToggle = document.getElementById('globalToggle');
    const statusText = document.getElementById('statusText');
    const statusIndicator = document.getElementById('statusIndicator');
    const openOptionsBtn = document.getElementById('openOptionsBtn');

    // 初期状態の読み込み
    chrome.storage.sync.get(['globalEnabled'], (result) => {
        const isEnabled = result.globalEnabled !== undefined ? result.globalEnabled : true;
        updateUI(isEnabled);
    });

    // トグル変更時
    globalToggle.addEventListener('change', (e) => {
        const isEnabled = e.target.checked;
        chrome.storage.sync.set({ globalEnabled: isEnabled }, () => {
            updateUI(isEnabled);
        });
    });

    // オプションページへ遷移
    openOptionsBtn.addEventListener('click', () => {
        if (chrome.runtime.openOptionsPage) {
            chrome.runtime.openOptionsPage();
        } else {
            window.open(chrome.runtime.getURL('options.html'));
        }
    });

    function updateUI(isEnabled) {
        globalToggle.checked = isEnabled;
        if (isEnabled) {
            statusIndicator.classList.add('active');
            statusText.textContent = '有効';
            statusText.style.color = 'var(--accent-color)';
        } else {
            statusIndicator.classList.remove('active');
            statusText.textContent = '無効';
            statusText.style.color = 'var(--text-secondary)';
        }
    }
});
