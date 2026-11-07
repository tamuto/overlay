# overlay

元のドキュメント（Markdown / HTML / Web ページ）には一切手を入れずに、**添削（コメント・修正提案）を重ねて表示・共有する**レビューツールのプロトタイプです。

- 指摘は別ファイル `*.overlay.json` に保存されます（原本は読み取り専用）
- 文書が更新されても、引用テキストと前後の文脈から指摘箇所を**再特定**します。見つからない指摘も消さずに「参照先消失」として残します
- サーバ経由で**リアルタイム共同編集**（Yjs）。サーバなしでもファイルの受け渡しで共有できます
- **AI 添削**は「下書き」として追加され、人が採用するまで確定しません。ローカルでは Codex CLI（Sign in with ChatGPT）を使うので API 従量課金は発生しません

## クイックスタート

```bash
pnpm install
pnpm build                                   # Web UI をビルド（packages/web/dist）
pnpm overlay serve examples --ai mock        # http://127.0.0.1:4141
```

ブラウザで開き、文書を選んで本文のテキストを選択 →「コメント」「修正提案」。
同じ URL を別のブラウザで開くとリアルタイムに同期されます。URL 欄に Web ページのアドレスを入れると、サーバが取得してスクリプトを除去したうえで表示します。

開発時（HMR）:

```bash
pnpm dev     # Vite (http://localhost:5173) + API サーバ (4141, --ai mock) を同時起動
```

## CLI

```bash
pnpm overlay serve [dir] [--ai codex|claude|openai[:model]|mock] [--port 4141] [--data dir] [--public]
pnpm overlay check  <file|url> --root <dir>   # 指摘が今の文書のどこを指すか検証（未解決の参照先消失があれば exit 1 → CI 向け）
pnpm overlay report <file|url> --root <dir> [-o review.md]   # 指摘一覧を Markdown で出力
pnpm overlay review <file|url> --root <dir> --ai codex [--instruction "観点"]   # AI 添削を下書きとして追記
```

`--root` は `serve` に渡したディレクトリと揃えてください（overlay ファイルは `<root>/.overlay/` 以下に、文書の相対パスをキーに保存されます）。

```
# mock AI で指摘を付けた後、文書を編集（冒頭に追記・「使用することができます」→「使用できます」・TODO 行を書き換え）
$ pnpm overlay check examples/guide.md --root examples
guide.md
  overlay: examples/.overlay/files/guide.md.overlay.json
  ⚠ 文書は指摘作成後に更新されています
  ↪ moved    「ので、レビュー用のコピーを作る必要があるため、」 理由の接続が連続していて読みにくくなっています。
  ≈ fuzzy    「することができます」 冗長な表現です。「できる」で十分です。
  ✗ orphaned 「TODO」 未記入の箇所が残っています。
  合計 3: moved=1 fuzzy=1 orphaned=1        # exit code 1
```

## 構成

| パッケージ | 役割 |
| --- | --- |
| `packages/core` | フレームワーク非依存。データモデル、アンカリング（再特定）、DOM ハイライト、マージ、レポート、AI プロンプト/スキーマ |
| `packages/server` | Hono（`@hono/node-server`）。文書の読み込み・サニタイズ、URL 取得、overlay ファイル保存、Yjs 同期（WebSocket）、AI プロバイダ |
| `packages/cli` | `overlay` コマンド（serve / check / report / review） |
| `packages/web` | React 19 + Tailwind CSS v4 + Vite。サーバなし（静的ホスティング）でも動作 |

詳しい設計判断は [docs/design.md](docs/design.md) を参照してください。

## 動作モード

| | スタンドアロン（静的サイト） | `overlay serve`（ローカル） | サービス化（将来） |
| --- | --- | --- | --- |
| 文書 | ブラウザでローカルファイルを開く | 指定ディレクトリ / URL | URL / Git 連携 |
| 保存 | localStorage | `.overlay/*.overlay.json` | DB + overlay ファイル |
| 共有 | overlay.json の書き出し/取り込み | リアルタイム（Yjs） + ファイル | リアルタイム + 認証 |
| AI | なし | Codex / Claude CLI（プラン内）, mock | OpenAI API など（従量課金） |

## テスト

```bash
pnpm test        # core のアンカリング/マージのユニットテスト (vitest)
pnpm typecheck
```
