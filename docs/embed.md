# @infodb/overlay/embed — Web アプリ画面への吹き出し・メモ

動いている Web アプリ（React / Vue / 素の HTML …）の画面に、**マニュアルのガイド**と**ユーザーのメモ**を重ねて表示します。アプリ本体の DOM やスタイルには手を入れず、UI は `<in4o-root>` 要素の Shadow DOM の中に描画します。

## 組み込み

```ts
import { createOverlay, urlSource, localSource } from '@infodb/overlay/embed'

const overlay = createOverlay({
  app: 'my-app',
  layers: [
    // システム側が作ったマニュアル。アプリと一緒に静的ファイルとして配布（ユーザーは閲覧のみ）
    { id: 'manual', label: 'マニュアル', kind: 'guide', source: urlSource('/help.overlay.json') },
    // ユーザー自身のメモ。このブラウザに保存
    { id: 'memo', label: '自分のメモ', kind: 'note', editable: true, source: localSource('my-app:memo') },
  ],
  user: { name: currentUser.name },
})

overlay.startTour()        // この画面のガイドを順番に案内
overlay.setMode('pick')    // 要素を選んでメモを追加
overlay.destroy()
```

右下のボタンからレイヤーの表示切替、ガイドツアー、メモの追加、書き出し / 取り込みができます。`launcher: false` にしてアプリ側のメニューから `overlay.*` を呼ぶこともできます。

### レイヤー

| 設定 | 意味 |
| --- | --- |
| `kind: 'guide'` | マニュアル用。青い「?」または順番の数字で表示し、`order` 順にツアーできる |
| `kind: 'note'` | メモ用。オレンジのペンアイコンで表示 |
| `editable: true` | 追加・編集・削除ができる |
| `source` | 読み書き先。`urlSource`（読み取り専用）、`localSource`（localStorage）、`memorySource`、または独自実装の `LayerSource`（自社 API に保存するなど） |

### ガイドの作り方（システム側）

サンプルアプリの `?author` モードと同じ流れです。

1. 編集可能な guide レイヤー（例 `localSource('my-app:guide-draft')`）を追加した状態でアプリを開く
2. 実際の画面で要素をクリックし、見出し・説明・順番を入力する
3. パネルの「書き出し」でファイルを保存し、`public/help.overlay.json` として配布する

## 要素の特定

**アプリ側に専用の属性がなくても動きます。** メモを付けた時点で、要素について次の手がかりをまとめて記録し、画面を開くたびに点数付けして最も合う要素を探します。

| 優先度 | 手がかり | 備考 |
| --- | --- | --- |
| 1 | `data-in4o-key` | 付いていれば最優先（見た目や文言が変わっても追従） |
| 2 | `data-testid` / `data-test` / `data-cy`、安定した `id` | `:r1:` や `mui-12` のような自動生成 ID は記録しない |
| 3 | 種類（role）と表示名 | ラベル、`aria-label`、ボタンの文字、`alt` など。入力欄に**入力された値は読まない** |
| 4 | 周りの文脈 | 所属する表の行・一覧の項目のテキスト、セクションやダイアログの見出し、`data-in4o-scope` |
| 5 | 構造上の位置（CSS パス） | 最後の手段 |
| 共通 | 画面（route） | 既定は URL のパス。`/orders/123` → `/orders/:id` のように ID らしい部分はまとめる。ハッシュルーター（`#/…`）にも対応。`route: () => …` で変更可 |

結果は次のように表示します。

- 見つかった: ピンを表示
- 確信が持てない（文言が変わった・候補が複数ある）: ピンを点線で囲み、吹き出しに「別の要素を指している可能性があります」と「付け直す」を表示
- 見つからない: パネルの「この画面で見つからない」に一覧し、「要素を選び直す」で付け直せる。メモは消さない

### アプリ側の属性（任意）

全部の部品に付ける必要はありません。自動特定が苦手な箇所（一覧の行の中のボタン、アイコンだけのボタン、文言が頻繁に変わる部品）や、マニュアルで確実に指したい部品にだけ付けてください。

| 属性 | 用途 |
| --- | --- |
| `data-in4o-key="order.save"` | 部品の目印。アプリ内で一意になるように（推奨: `画面.部品`） |
| `data-in4o-scope="order-row"` | 一覧の行やカードなど、繰り返しの範囲。中の部品は「どの行か」も合わせて特定する |
| `data-in4o-ignore` | この中には付けられない。テキストも記録しない（個人情報・社外秘の欄など） |

`data-in4o-scope` 付きの行の中にある部品は、次のように扱います。

- ユーザーがクリックしてメモを付けた場合: 行のテキストも記録するので「佐藤工業の行の編集ボタン」として特定する（並び替えや絞り込みにも追従）
- ガイドで行のテキストを指定しない場合（`"scope": { "key": "order-row" }`）: 「どの行でもよい、最初の行の編集ボタン」として扱う

接頭辞 `in4o` は `createOverlay({ prefix: 'acme' })` で `data-acme-*` に変更できます。

## 保存形式

ドキュメントのレビューと同じ `*.overlay.json` を使います。アプリ用の指摘は `document.type: "app"`、`target.route` に画面、`selectors` に `ElementSelector` が入ります。

```jsonc
{
  "version": 1,
  "document": { "type": "app", "source": "react-app-example" },
  "annotations": [{
    "id": "guide-01", "kind": "guide", "title": "受注の登録", "text": "新しい受注を登録します。", "order": 1,
    "target": {
      "route": "/orders",
      "fingerprint": "",
      "selectors": [{ "type": "ElementSelector", "tag": "button", "key": "orders.new", "role": "button", "name": "新規作成" }]
    },
    "author": { "name": "system", "kind": "human" }, "status": "open", "replies": [],
    "createdAt": "…", "updatedAt": "…"
  }]
}
```

## 今後

- チームで共有するメモ: `overlay serve` の Yjs 同期を使う `LayerSource`（別オリジンからの接続を許可する設定が必要）
- ブラウザ拡張: 自分で組み込めない他社アプリや社内システムに、同じ embed を注入する
- ガイドの多言語化、表示条件（初回だけ表示する、権限で出し分ける）
- iframe 内や Shadow DOM 内の部品への対応
