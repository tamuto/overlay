# @infodb/overlay

元のドキュメントや Web アプリには一切手を入れずに、**添削・メモ・操作ガイドを重ねて表示・共有する**ツールのプロトタイプです。

- **ドキュメントのレビュー**: Markdown / HTML / Web ページに添削（コメント・修正提案）を重ねる（`overlay serve`）
- **Web アプリへの吹き出し**: 動いている React などのアプリ画面に、マニュアルのガイドやユーザーのメモを重ねる（`@infodb/overlay/embed`、[docs/embed.md](docs/embed.md)）


- 指摘は別ファイル `*.overlay.json` に保存されます（原本は読み取り専用）
- 文書が更新されても、引用テキストと前後の文脈から指摘箇所を**再特定**します。見つからない指摘も消さずに「参照先消失」として残します
- サーバ経由で**リアルタイム共同編集**（Yjs）。サーバなしでもファイルの受け渡しで共有できます
- **AI 添削**は「下書き」として追加され、人が採用するまで確定しません。ローカルでは Codex CLI（Sign in with ChatGPT）を使うので API 従量課金は発生しません

## クイックスタート

```bash
pnpm install
pnpm build                                   # Web UI とパッケージをビルド（packages/overlay/dist）
pnpm overlay serve examples --ai mock        # http://127.0.0.1:4141
```

ブラウザで開き、文書を選んで本文のテキストを選択 →「コメント」「修正提案」。
同じ URL を別のブラウザで開くとリアルタイムに同期されます。URL 欄に Web ページのアドレスを入れると、サーバが取得してスクリプトを除去したうえで表示します。

開発時（HMR）:

```bash
pnpm dev     # Vite (http://localhost:5173) + API サーバ (4141, --ai mock) を同時起動
```

Web アプリへの吹き出しを試す:

```bash
pnpm example     # http://localhost:5180  （?author を付けるとガイド作成モード）
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

公開するのは `@infodb/overlay` 1パッケージで、用途ごとに読み込み先を分けています。

| 読み込み先 | 中身 | 実行環境 |
| --- | --- | --- |
| `@infodb/overlay` | データモデル、文章のアンカリング（再特定）、DOM ハイライト、マージ、レポート、AI プロンプト/スキーマ | ブラウザ / Node |
| `@infodb/overlay/embed` | Web アプリ画面への吹き出し・メモ（要素の特定、ガイドツアー、ピン） | ブラウザ |
| `@infodb/overlay/server` | Hono サーバ（文書の読み込み・URL 取得・保存・Yjs 同期・AI） | Node |
| `overlay` コマンド | serve / check / report / review（レビュー UI を同梱） | Node |

リポジトリ:

| パス | 内容 |
| --- | --- |
| `packages/overlay` | 公開パッケージ本体（`src/core` `src/embed` `src/server` `src/cli`）。tsup でビルド |
| `packages/web` | レビュー UI（React 19 + Tailwind v4 + Vite、非公開）。ビルド結果は `packages/overlay/dist/web` に入る |
| `examples/react-app` | embed を組み込んだ React のサンプルアプリ |

詳しい設計判断は [docs/design.md](docs/design.md) と [docs/embed.md](docs/embed.md) を参照してください。

## 動作モード

| | スタンドアロン（静的サイト） | `overlay serve`（ローカル） | サービス化（将来） |
| --- | --- | --- | --- |
| 文書 | ブラウザでローカルファイルを開く | 指定ディレクトリ / URL | URL / Git 連携 |
| 保存 | localStorage | `.overlay/*.overlay.json` | DB + overlay ファイル |
| 共有 | overlay.json の書き出し/取り込み | リアルタイム（Yjs） + ファイル | リアルタイム + 認証 |
| AI | なし | Codex / Claude CLI（プラン内）, mock | OpenAI API など（従量課金） |

## テスト

```bash
pnpm test        # アンカリング・要素特定・マージのユニットテスト (vitest)
pnpm typecheck
```
