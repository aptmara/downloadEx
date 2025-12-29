# DownloadEx - ダウンロードフォルダ振り分け

[![Chrome Web Store](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.3.0-blue.svg)](manifest.json)

**DownloadEx** は、ダウンロードファイルをルールベースで自動的に指定フォルダへ振り分けるChrome拡張機能です。

![DownloadEx Options](images/images_square_128x128.png)

---

## ✨ 主な機能

- **🎯 柔軟なルールマッチング**: URL部分一致、完全一致、正規表現に対応
- **📁 サブフォルダ自動作成**: ダウンロードフォルダ内に自動でサブフォルダを作成
- **📅 動的プレースホルダー**: `{YYYY-MM-DD}`, `{domain}` などでフォルダ名を動的生成
- **🏷️ ファイルタイプフィルター**: 拡張子ごとに異なるルールを適用可能
- **⚡ 優先度ベースルール**: 複数ルールがマッチした場合、優先度順に適用
- **🖱️ コンテキストメニュー統合**: 右クリックから簡単にルール作成
- **🔧 シンプル/エキスパートモード**: 初心者から上級者まで使いやすいUI

---

## 🚀 インストール

### Chrome ウェブストアから
(公開後にリンクを追加)

### 開発者モードでインストール

1. このリポジトリをクローンまたはダウンロード
   ```bash
   git clone https://github.com/aptmara/downloadEx.git
   ```

2. Chrome で `chrome://extensions/` を開く

3. 右上の「デベロッパーモード」をオンにする

4. 「パッケージ化されていない拡張機能を読み込む」をクリック

5. ダウンロードしたフォルダを選択

---

## 📖 使い方

### 基本的な流れ

1. **拡張機能アイコンをクリック** → ポップアップが開きます
2. **グローバルトグル** で機能の有効/無効を切り替え
3. **歯車アイコン** をクリックしてオプションページへ
4. **「新規ルール」** ボタンでルールを追加

### ルール設定例

| パターン | マッチタイプ | 保存先フォルダ |
|---------|------------|---------------|
| `github.com` | 部分一致 | `GitHub/{YYYY-MM-DD}` |
| `^https://example\.com/files/` | 正規表現 | `Example` |
| `drive.google.com` | 部分一致 | `GoogleDrive` |

### プレースホルダー

| プレースホルダー | 説明 | 例 |
|-----------------|------|-----|
| `{YYYY}` | 年 (4桁) | `2025` |
| `{MM}` | 月 (2桁) | `12` |
| `{DD}` | 日 (2桁) | `29` |
| `{YYYY-MM-DD}` | 日付 | `2025-12-29` |
| `{domain}` | ドメイン名 | `github.com` |

---

## 🎨 UI デザイン

「Ultra-Clean Minimal」コンセプトに基づいた、視認性と操作性を重視したモダンなデザインです。

- **余白を活かしたレイアウト**: 情報の密度を適切にコントロール
- **アクセントカラー**: エレクトリックブルー (`#2563eb`) を効果的に使用
- **スムーズなアニメーション**: マイクロインタラクションで快適な操作感

---

## ⚡ パフォーマンス最適化

v1.3.0 では以下の最適化を実施し、最高レベルのパフォーマンスを実現しています：

| 最適化項目 | 効果 |
|-----------|------|
| **同期イベント処理** | 単一ファイルダウンロード時のレイテンシを最小化 |
| **グローバルステートキャッシュ** | 毎回のストレージアクセスを排除 |
| **メモリフットプリント削減** | 必要最小限のデータのみをメモリにキャッシュ |
| **デバウンスログ保存** | 大量ダウンロード時のI/O負荷を軽減 |

---

## 🛠️ 開発

### 必要要件

- Google Chrome (または Chromium ベースブラウザ)

### ファイル構成

```
downloadEx/
├── manifest.json      # 拡張機能マニフェスト (v3)
├── background.js      # Service Worker (ダウンロード処理)
├── popup.html/css/js  # ポップアップUI
├── options.html/css/js# オプションページUI
├── analyzer.js        # ルール提案エンジン
└── images/            # アイコン
```

### ローカル開発

1. コードを編集
2. `chrome://extensions/` で拡張機能をリロード
3. 動作確認

---

## 📄 ライセンス

このプロジェクトは [MIT License](LICENSE) のもとで公開されています。

---

## 🤝 コントリビューション

Issue や Pull Request は歓迎します！

1. このリポジトリをフォーク
2. 機能ブランチを作成 (`git checkout -b feature/amazing-feature`)
3. 変更をコミット (`git commit -m 'Add amazing feature'`)
4. ブランチにプッシュ (`git push origin feature/amazing-feature`)
5. Pull Request を作成

---

## 📞 サポート

バグ報告や機能リクエストは [Issues](https://github.com/aptmara/downloadEx/issues) からお願いします。

---

Made with ❤️ for better download management.