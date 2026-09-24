# NanoKVM AI Console

NanoKVM Go が提供するリモート MCP (Model Context Protocol) サーバーと、ローカルネットワーク上の llama.cpp server (OpenAI互換API) を接続し、AIとの自然な対話形式でターゲットPCの画面認識や遠隔操作を行えるデスクトップAIコンソールです。

> 📖 **関連リンク**: [Sipeed NanoKVM Go 公式Wiki (Introduction)](https://wiki.sipeed.com/hardware/en/kvm/NanoKVM_Go/introduction.html)

---

## 開発の背景・経緯

[Sipeed NanoKVM Go](https://wiki.sipeed.com/hardware/en/kvm/NanoKVM_Go/introduction.html) は、超小型のハードウェアKVMでありながら、**標準でリモート MCP (Model Context Protocol) サーバー機能を備えている非常に意欲的で面白い製品**です。

しかし、実際にAIエージェントや外部クライアントから接続して試そうとすると、以下のような実用上のハードルがありました：

- **自己署名証明書（SSL/TLS）の壁**:
  NanoKVM Go はローカルIP (`https://<IP>/api/mcp`) 上で自己署名SSLで稼働するため、一般的なLLMクライアントやMCP連携ツールから接続しようとすると証明書検証エラー（`UNABLE_TO_VERIFY_LEAF_SIGNATURE` 等）で弾かれ、回避設定が地味に面倒。
- **認証ヘッダーと接続管理の手間**:
  NanoKVM Go 側で発行された API Key のヘッダー付与や疎通テスト、ツールの引数仕様の把握を手動で行う必要がある。
- **操作の可視化と安全性の確保**:
  AIにPC操作（キーボード・マウス・電源）を任せる場合、「AIが今どこをクリックしようとしているのか」「危険な操作をしていないか」を直感的に確認・一時停止できる環境が整っていなかった。

そこで、**「SSL証明書や認証まわりの面倒をまるごと吸収し、ローカルLLM（llama.cpp）と組み合わせて安全かつワンクリック感覚でターゲットPCの画面認識・自律操作・監視を行える環境を作る」** ことを目指して本コンソールを開発しました。

## 主な特徴

- 🚀 **llama.cpp server 連携**: OpenAI互換エンドポイント (`/v1/chat/completions`) を通じてローカルLLMで動作。モデル自動検出やストリーミング応答に対応。
- 🔒 **自己署名証明書 (TLS) の安全なスキップ**: NanoKVM Go の `https://<IP>/api/mcp` はSSL証明書未発行（自己署名）ですが、アプリ内の設定からTLS検証エラーを自動無視して安全にローカルLAN接続。
- 🔑 **Authorizationヘッダー自動付与**: NanoKVM Go で発行された API Key を `Authorization: Bearer <API-Key>` ヘッダーとして自動付加。
- 🛠️ **MCP Tool 連携 & 自律ループ**:
  - NanoKVM Go の画面キャプチャ、マウス操作、キーボード入力などの MCP ツールを自動検出。
  - LLM が自律的にツールを呼び出す Tool Calling ループをサポート。
  - キャプチャされた画面のインライン表示 & クリック拡大プレビューに対応。
- 🖼️ **画面キャプチャ履歴サイドバー & 差分比較 (Diff View)**:
  - 過去に取得されたスクリーンショットをサムネイルタイムラインとして一覧表示。
  - サムネイルクリックでチャット内の該当メッセージ位置へ自動スクロール＆ハイライト。
  - 2枚のキャプチャを左右スライダーまたは並列で比較できる Diff モーダル機能。
- 🎯 **操作箇所のビジュアル・オーバーレイ**:
  - AIが指示したクリック座標 $(X, Y)$ を画像上に照準マーカー＆波紋アニメーションで可視化。
- 🖥️ **Live WebKVM リアルタイム埋め込みパネル**:
  - アプリ内で直接 NanoKVM の Web リモートデスクトップ（`https://<IP>/#/`）を開閉・リサイズ可能。
  - AIの自律操作をリアルタイム動画ストリームで見守りつつ、人間がいつでも手動でマウス・キーボード介入可能。
  - 自己署名証明書の警告を自動承認してシームレスに表示。
- ⚡ **ハードウェア・クイックアクションバー**:
  - チャット上部にワンクリックで実行できるKVMボタンを常設（「📸 スクショ撮影」「⌨️ Ctrl+Alt+Del」「⚡ 電源短押し」「🛑 強制電源OFF」「🔄 ハードウェアリセット」）。
- 🛑 **緊急停止 (Kill Switch)**:
  - AIの思考中やツール自律操作の最中に、ワンクリックで即座にストップ・安全停止できる停止ボタン。
- 🛡️ **ステップ承認モード (Human-in-the-Loop)**:
  - ツール実行前に一時停止し、ユーザーが【承認して実行】【スキップ】【中断】を選択できる安全ガード機能。
- 🎯 **Visual Prompting（画像座標ピッカー）**:
  - スクショ上をクリックするだけで、正確な座標 $(X, Y)$ をプロンプト入力欄に自動挿入して指示可能。
- 🔌 **外部エージェント向け MCP Proxy (Claude / Cursor / Antigravity)**:
  - 付属の `bin/nanokvm-mcp-proxy.js` を使用し、Claude Desktop や Cursor からでも NanoKVM の自己署名証明書やAPI認証を自動処理して直接操作可能。
- ⏱️ **定期実行 & 条件監視 (Watchdog) エンジン**:
  - **「〜の状態になったら通知 / 実行」**: 画面キャプチャを定期チェックし、自然言語で指定した条件（「ブルースクリーンが発生」「ログイン画面が表示された」「インストールが完了した」等）をAIが画像認識・判定。
  - **自動アクション連動**: 条件合致時にOSデスクトップ通知、特定MCPツール（電源リセット等）の自動実行、フォローアップ指示の送信などをシームレスに連携。
  - **定期プロンプト巡回**: 指定インターバル（N分おき）や指定日時にプロンプトをバックグラウンド実行。
  - **Electron Main常駐型**: ウィンドウ最小化時でもタイマースロットリングの影響を受けずに確実にバックグラウンド実行。
- ⚙️ **GUI設定管理**: サーバーURL、APIキー、システムプロンプト、TLS検証の有効/無効をアプリ内から手軽に変更・永続化。

---

## 必要な前提環境

1. **llama.cpp server**:
   ローカルPCまたは同一LAN内のマシンで `llama-server` を起動しておきます。
   ```bash
   ./llama-server -m /path/to/model.gguf --port 8080 --host 0.0.0.0
   ```
   ※ Tool calling対応モデル（Qwen2.5, Llama-3.1, Mistral等）を推奨します。

2. **NanoKVM Go**:
   - ターゲットPCに接続し、NanoKVM Go のWeb管理画面を開きます。
   - **Settings** > **MCP** を開き、MCPスイッチを **ON** にします。
   - 表示された `Endpoint` (例: `https://192.168.1.45/api/mcp`) と `API Key` を確認します。

---

---

## インストール方法

### macOS (Homebrew 経由)
macOS の隔離属性（Gatekeeper の「開発元が未確認のため開けません」警告）を自動解除（`xattr -cr`）してインストールできます：

```bash
# Cask 定義 URL を直接指定してインストール
brew install --cask https://raw.githubusercontent.com/blue1st/nanokvm-ai-console/main/Casks/nanokvm-ai-console.rb
```

### GitHub Releases からの手動ダウンロード
[Releases ページ](https://github.com/blue1st/nanokvm-ai-console/releases) より、各プラットフォーム向けの最新インストーラーをダウンロードしてください。

- **macOS**: `NanoKVM-AI-Console-<version>-mac-arm64.dmg` (Apple Silicon) または `x64.dmg` (Intel)
  - ※ 初回起動時に「開発元が未確認のため開けません」と表示された場合は、ターミナルで以下のコマンドを実行して隔離属性を解除してください：
    ```bash
    xattr -cr /Applications/"NanoKVM AI Console.app"
    ```
- **Windows**: `NanoKVM-AI-Console-<version>-win-x64.exe`
- **Linux**: `NanoKVM-AI-Console-<version>-linux-x64.AppImage`

---

## 開発 & ビルド・リリース手順

### 開発モード起動
```bash
npm install
npm run dev
```

### ローカルでのビルド & パッケージング
```bash
# アプリのコードビルド
npm run build

# macOS 用インストーラー (DMG / Zip) の生成
npm run package:mac

# Windows 用インストーラー (NSIS / Zip) の生成
npm run package:win

# Linux 用 (AppImage / tar.gz) の生成
npm run package:linux
```

### release-it によるリリース自動化
バージョン採番、Gitタグ作成、GitHub Release作成、および GitHub Actions によるマルチプラットフォーム自動ビルドを1コマンドで実行できます：

```bash
# リリース確認 (Dry-run)
npm run release:dry

# 本番リリース (Gitタグ作成・Push・GitHub Release作成)
GITHUB_TOKEN="ghp_xxx" npm run release
```
タグ（`v*`）が Push されると、GitHub Actions が自動的に macOS / Windows / Linux 向けバイナリをビルドし、Release ページにアタッチします。

---

## アプリ内の初期設定

1. アプリを起動後、右上の ⚙️（歯車アイコン）をクリックします。
2. **llama.cpp Server 設定**:
   - **エンドポイント URL**: 例 `http://192.168.1.100:8080` または `http://localhost:8080`
   - **接続テスト / モデル一覧更新**: クリックして利用可能なモデルを取得
3. **NanoKVM Go Remote MCP 設定**:
   - **MCP エンドポイント URL**: 例 `https://192.168.1.45/api/mcp`
   - **API Key**: NanoKVM Web画面で確認した API Key を入力
   - **自己署名証明書 / 証明書検証エラーを無視する**: チェック（ON）
   - **NanoKVM MCP 接続テスト**: クリックして接続とツール取得を確認
4. **設定を保存** をクリックします。

---

## 使い方・プロンプト例

チャット入力欄または提案ボタンから、自然言語で指示を出します：

- 「現在の画面を確認して、何が表示されているか教えて」
  - NanoKVMの画面取得ツールが自動実行され、チャット画面上に現在のスクリーンショットが表示されます。
- 「画面中央のボタンをクリックして」
- 「Enterキーを入力して」
- 「端末を開いて、ネットワークのIPアドレスを確認して」
- 「インストーラー画面の次へボタンを押して進めて」

---

## 外部エージェント (Claude Desktop / Cursor) からの利用

本アプリ付属の `bin/nanokvm-mcp-proxy.js` を使用することで、Claude Desktop や Cursor 等の外部ツールから NanoKVM を直接操作できます。

### Claude Desktop の設定 (`claude_desktop_config.json`)
```json
{
  "mcpServers": {
    "nanokvm": {
      "command": "node",
      "args": [
        "/Users/t-kawasaki/src/desktop-apps/nanokvm-go-client/bin/nanokvm-mcp-proxy.js"
      ],
      "env": {
        "NANOKVM_ENDPOINT": "https://192.168.1.45/api/mcp",
        "NANOKVM_API_KEY": "your_api_key_here"
      }
    }
  }
}
```
※ アプリ内の設定画面（⚙️）の「5. 外部LLM連携 MCP Proxy」から、現在の接続情報を埋め込んだJSONをワンクリックでコピーできます。
