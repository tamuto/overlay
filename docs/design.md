# 設計メモ

プロトタイプで採った設計判断と、まだ決めていない論点をまとめる。

## 1. 原本に手を入れない

- 文書は **読み取り専用**。指摘は `*.overlay.json`（W3C Web Annotation の考え方に沿った独自 JSON）に保存する
- 表示は `<iframe sandbox="allow-same-origin">`（`allow-scripts` なし）内の**コピー**に `<mark>` を差し込む。対象ページのスクリプトは実行されず、親 UI からは DOM を読める
- Web ページはサーバ側で取得し（CORS 回避）、`script` / `on*` 属性 / `javascript:` URL / `meta refresh` を除去し `<base href>` を付けて返す
- サーバなしのモードではブラウザ内でファイルを読み、DOMPurify でサニタイズする（アップロードはしない）

### overlay ファイルの形

```jsonc
{
  "version": 1,
  "document": { "type": "markdown", "source": "guide.md", "title": "…", "fingerprint": "e6347b10…" },
  "annotations": [{
    "id": "uuid",
    "kind": "comment" | "suggestion",
    "text": "指摘内容", "suggestion": "置き換え案",
    "target": {
      "fingerprint": "指摘作成時の文書ハッシュ",
      "selectors": [
        { "type": "TextQuoteSelector", "exact": "原本が汚れてしまう", "prefix": "…前32文字", "suffix": "後32文字…" },
        { "type": "TextPositionSelector", "start": 120, "end": 129 }
      ]
    },
    "author": { "name": "alice", "kind": "human" },   // AI は kind: "ai", via: "codex"
    "status": "open" | "resolved", "draft": true,     // draft = 未採用の AI 指摘
    "replies": [ … ], "createdAt": "…", "updatedAt": "…"
  }]
}
```

- 保存先: `<root>/.overlay/files/<相対パス>.overlay.json`、URL は `<root>/.overlay/web/<host>/<slug>-<hash>.overlay.json`
- Git にコミットしてレビュー記録として残せる。オフラインで並行編集した 2 ファイルは `mergeOverlays`（id 単位で新しい方を採用・返信は和集合）で統合できる

## 2. 文書が更新されたときの再特定（アンカリング）

アンカーは「描画後のテキスト（空白を正規化したもの）」に対して張る。HTML の整形や Markdown の折り返しが変わっても影響しない。ブラウザ（DOM）と CLI（linkedom）で同じ抽出関数を使うので、ブラウザで付けた指摘を CLI で検証しても位置がずれない。

解決は安い順に試す（`packages/overlay/src/core/anchor.ts`）:

| 手順 | 結果 |
| --- | --- |
| 記録位置に同じ引用＋同じ前後文脈 | **一致** (exact) |
| 引用が別の場所に存在 → 前後文脈の類似度で最良の出現を選ぶ | **位置移動** (moved) |
| 前文脈 … 後文脈 の間を新しい引用とみなす（引用部分だけ書き換えられたケース） | **本文変更あり** (fuzzy) |
| 編集距離による近似検索（Sellers 法、類似度 0.7 以上） | **本文変更あり** (fuzzy) |
| 見つからない | **参照先消失** (orphaned)。削除せず一覧末尾に残す |

UI では「本文変更あり」の指摘に指摘時の文面を併記し、「この位置で確定」（新しい位置でアンカーを張り直す）か「選択範囲に付け替え」ができる。`overlay check` は未解決の参照先消失があると exit 1 を返すので、CI で「文書を更新したら未対応の指摘が宙に浮いた」ことを検知できる。

今後の改善候補:
- 文書のバージョン（Git コミット）を記録し、diff ベースで位置を追跡する（テキスト検索より確実）
- Markdown ソース上の位置（行・列）もセレクタとして保持し、`overlay apply` で修正提案をソースに反映する
- 見出し構造（セクション）を文脈として使う

## 3. 共有とリアルタイム共同編集

- 共有の基本単位は **overlay ファイル**（書き出し / 取り込み / Git）
- リアルタイムは **Yjs**。サーバは y-websocket 互換プロトコルを `ws` で最小実装し（`packages/overlay/src/server/collab.ts`）、ルームの状態を 0.5 秒デバウンスで overlay ファイルに書き戻す。つまり「リアルタイム」と「ファイル共有」は同じデータ
- Y.Doc は `annotations: Y.Map<id, Annotation>`。指摘単位の Last-Writer-Wins で、プロトタイプとしては十分。返信の同時追加などを厳密にしたくなったら、返信を `Y.Array` にするなど構造を細かくする
- 参加者表示は Yjs awareness

## 4. なぜ Hono か

- Web 標準の `Request/Response` ベースなので、同じアプリを Node（ローカル CLI）でも Cloudflare Workers / Deno / Bun（サービス化）でも動かせる
- ルーティング・ミドルウェアが軽量で、CLI に同梱しても起動が速い
- 注意点: WebSocket と Yjs の永続化はランタイム依存。ローカルは Node + `ws`、サービス化するなら Cloudflare Durable Objects（`y-durableobjects` 等）や専用の同期サーバ（Hocuspocus / y-sweet）に置き換える想定。`CollabHub` の境界で差し替えられるようにしてある

## 5. AI 添削

### 原則

- **AI は文書にも overlay にも直接書き込まない。** `{quote, comment, suggestion, severity}` の配列（findings）を返すだけで、引用の位置特定とアノテーション化はこちら側で行う（`findingsToAnnotations`）
- AI 由来の指摘は `draft: true` で追加され、人が「採用」するまで確定しない
- プロバイダはサーバ側の `AiProvider` インターフェースで差し替え可能。プロンプトと JSON スキーマは `core/src/ai.ts` に共通化

### プロバイダ

| 名前 | 認証 / 課金 | 用途 |
| --- | --- | --- |
| `codex` | **Codex CLI に Sign in with ChatGPT** でログイン済みのセッションを使う。ChatGPT プラン内で、API 従量課金なし | ローカル |
| `claude` | Claude Code CLI のログインを使う（プラン内） | ローカル |
| `openai` | `OPENAI_API_KEY`（Responses API + Structured Outputs）。従量課金 | サービス化 |
| `mock` | なし（ルールベース） | デモ・テスト |

### 「Sign in with ChatGPT」をどう使うか

- 自前アプリに ChatGPT の OAuth を直接組み込んでトークンを扱うのではなく、**公式 Codex CLI に認証を任せ、`codex exec` を子プロセスとして呼ぶ**方式にした。トークンをこちらで保持しないので、安全面でも利用規約の面でも無理がない
- 呼び出しは空の一時ディレクトリで `--sandbox read-only --ephemeral --output-schema <schema>` を付けて実行する。文書はプロンプトに埋め込むので、エージェントにファイルやコマンドを触らせる必要がない
- 書き込みは API 経由ではなく、**CLI の出力（JSON）をサーバが受け取り、Yjs 経由で下書きとして追加する**。共同編集中の他の人にもそのまま見える
- 制約: ログインはそのユーザーのローカルマシン上の CLI セッションに紐づく。**サービスとして他人のために使うものではない**（多人数向けには API キー方式）。そのため AI エンドポイントは `--ai` を指定したローカルサーバでのみ有効

### ローカルサーバの安全対策

- 既定で `127.0.0.1` に bind
- 状態を変える / コストがかかるエンドポイント（AI・文書取得・保存）は `X-Overlay-Client` ヘッダ必須かつ Origin が同一ホストであること。悪意あるサイトから localhost への CSRF で AI を勝手に実行されるのを防ぐ
- WebSocket も Origin を検査
- `--public` 指定時はプライベートネットワーク宛ての URL 取得を拒否（SSRF 対策の最低限。DNS rebinding まで含めた対策はサービス化時に実施）

## 6. 未実装・次の一手

- ~~ライブページ上へのオーバーレイ~~ → `@infodb/overlay/embed` として実装（[embed.md](embed.md)）。他社アプリやログインが必要な社内システム向けに、同じ embed を注入するブラウザ拡張は未実装
- 認証・権限（サービス化）、ルーム一覧、通知
- 修正提案のソースへの反映（`overlay apply` / GitHub の suggestion コメントへの変換）
- 画像・PDF への座標ベースの注釈（旧 sample の方式）
- パッケージのビルド（現状は tsx で TS ソースを直接実行）
