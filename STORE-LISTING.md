# Chrome Web Store 申請フォーム記入内容（v1.0.0）

Developer Dashboard の各欄へ、このまま貼れる形にしてある。
アップロードするZIPは `dist/memoria-context-faucet-1.0.0.zip`（`node scripts/build-store.mjs` で生成）。

---

## Store listing タブ

### Name（Store title / 最大75文字）

```
Memoria Context Faucet
```

### Summary（Short description / 最大132文字）

```
今開いているページに関係する自分の記憶を、Mac内のMemoriaから思い出すサイドパネル。外部サーバーへの送信はありません。
```

### Description（Detailed description）

```
Memoria Context Faucet は、いま開いているページに関係する「自分の記憶」を、Chromeのサイドパネルに並べる拡張機能です。

■ 何をするか

・現在のページのタイトルとドメイン、そして選択したテキストだけを手がかりにします
・その手がかりを、あなたのMacの中で動く Memoria の読み取りAPI（http://127.0.0.1:4319）へ渡します
・返ってきた「このページに関連する記憶」「続きから（作業中・中断中のタスク）」「いまの文脈」を表示します

■ 何をしないか

・ページ本文を読みません
・パスワード、フォーム入力、Cookie、閲覧履歴を読みません
・外部サーバー、当方のサーバー、クラウド、広告・解析サービスへ一切送信しません
・リモートのコードを読み込みません
・閲覧しているページの表示や動作には手を加えません

問い合わせ先は 127.0.0.1（あなたのMac自身）の1本だけです。

■ 動作条件

この拡張機能は、あなたのMacの中で Memoria の読み取りAPI が動いていることを前提にしています。
動いていない場合、拡張機能は記憶を表示せず、「つながっていないこと」と「何をすれば直るか」だけを
サイドパネルに表示します。ブラウジングの妨げにはなりません。

Memoria を持っていない方が入れても、害はありませんが、表示できる内容もありません。

■ 使い方

1. Mac で Memoria の読み取りAPI を起動する
2. ツールバーの Memoria アイコンを押してサイドパネルを開く
3. ページを移動したら、パネル右上の ↻ を押して読み込み直す

■ ソースコード

https://github.com/kota1020/memoria-chrome-extension
```

### Category

```
Productivity（サブカテゴリ: Workflow & Planning）
```

### Language

```
日本語 (Japanese)
```

### Graphic assets（`store-assets/` に生成済み）

| 欄 | ファイル | サイズ |
|---|---|---|
| Store icon | `icons/icon-128.png` | 128×128 |
| Screenshot 1 | `store-assets/01-page-memories.png` | 1280×800 |
| Screenshot 2 | `store-assets/02-resume.png` | 1280×800 |
| Screenshot 3 | `store-assets/03-local-only.png` | 1280×800 |
| Small promo tile（任意） | `store-assets/promo-tile-440x280.png` | 440×280 |

### Support URL / Homepage URL

```
https://github.com/kota1020/memoria-chrome-extension
```

---

## Privacy タブ

### Single purpose（単一用途の説明）

```
いま開いているページに関係する、利用者自身のMemoriaの記憶を、Chromeのサイドパネルに表示すること。
```

### Permission justification（権限ごとの理由）

| 権限 | 貼る文面 |
|---|---|
| `activeTab` | 利用者がサイドパネルを開いている現在のタブから、利用者が明示的に選択したテキストだけを読み取り、関連する記憶を絞り込む手がかりに使うため。ページ本文は読み取らない。 |
| `scripting` | 選択テキストを取得する短い関数（window.getSelection の読み取りのみ）を、現在のタブでのみ実行するため。ページの表示や動作は変更しない。 |
| `tabs` | サイドパネルが「いま見ているページ」を追えるようにするため。使用するのはタブのタイトルとURLのホスト名だけで、履歴の取得や保存は行わない。 |
| `sidePanel` | 拡張機能の唯一のUIであるサイドパネルを表示するため。 |
| ホスト権限 `http://127.0.0.1:4319/*` | 利用者自身の端末で動作するMemoria読み取りAPIへ接続するため。ループバックアドレスであり、端末外への通信は発生しない。他のホスト権限は要求していない。 |
| リモートコード | 使用していない。すべてのコードはパッケージに同梱されている。 |

### Data usage（データ利用の申告）

チェックする項目:

- **Website content** — チェックする（ページのタイトル、ホスト名、利用者が選択したテキスト）

チェックしない項目: 個人を特定できる情報 / 健康情報 / 金融情報 / 認証情報 / 個人的なやり取り /
位置情報 / 閲覧履歴 / ユーザーの操作履歴

3つの確認事項（すべて該当）:

- 承認された用途以外にユーザーデータを販売・譲渡しない
- 商品の単一用途と無関係な目的でユーザーデータを使用・転送しない
- 信用力の判断や融資目的でユーザーデータを使用・転送しない

補足として貼る文面:

```
取得するのは、サイドパネルを開いている間の「現在のタブのタイトル」「ホスト名」「利用者が明示的に選択した
テキスト（最大800文字）」の3点のみ。送信先は利用者自身の端末上の 127.0.0.1:4319 だけで、外部サーバーへは
一切送信しない。拡張機能側での保存も行わない（chrome.storage を使用していない）。
```

### Privacy policy URL

```
https://github.com/kota1020/memoria-chrome-extension/blob/main/PRIVACY.md
```

---

## Test instructions（審査担当者向け・英語で貼る）

```
This extension is a client for Memoria, a local-only personal memory service that runs on the
user's own machine. It only talks to http://127.0.0.1:4319 on the reviewer's machine. It never
contacts any remote server.

Because that local service is not part of the package, this repository ships a small stub with the
same response shape so the UI can be reviewed:

  1. git clone https://github.com/kota1020/memoria-chrome-extension
  2. node tools/mock-memoria-api.mjs        (Node.js 18+, starts http://127.0.0.1:4319)
  3. Open any web page, click the Memoria toolbar icon to open the side panel.
     The panel shows demo memory cards derived from the page title and hostname.
  4. Select some text on the page and press the refresh button in the panel.
     The selected text is added as an extra hint.
  5. Stop the stub with Ctrl-C and press refresh again. The panel shows an explanatory
     "not connected" state instead of any content. This is the expected experience for
     anyone who does not run Memoria.

No account, login, or payment is required. The stub returns fixed fictional data and reads
nothing from disk or the network.
```

---

## 未対応・次のバージョン以降

- **AIの入力欄への記憶の受け渡し（handoff）** — 1.0.0 には含めていない。1.0.0 の審査が通ってから 1.1.0 で足す。

  2026-09-03 に Gemini 実機で確認したところ、送信を止めきる前に Gemini 側が先に送信してしまい、
  二重送信になりうることが分かったため外した。**同日、原因の特定と修正まで済んでいる。**

  原因は登録タイミングではなく world の違いだった。拡張の content script は ISOLATED world で動くため、
  そこから `stopImmediatePropagation()` を呼んでもページ側のリスナーには効かない
  （`preventDefault()` は共有されるが、Gemini は `defaultPrevented` を見ずに送信する）。
  `document` を `window` に変えても、`document_start` に前倒ししても同じだった。

  修正は `shared/handoff-gate.js` を MAIN world の content script として document_start に置き、
  送信を1回止める役だけをそこに持たせる形。何を渡すかの判断とパネルは ISOLATED 側のまま。
  Gemini 実機で、渡す場合・渡さない場合とも「1回だけ送信される」ことを確認済み（開発版 0.4.0）。

  1.1.0 で出す場合、`https://claude.ai/*` `https://chatgpt.com/*` `https://chat.openai.com/*`
  `https://gemini.google.com/*` のホスト権限と MAIN world の content script が増えるため、
  権限理由とプライバシーポリシー（入力欄の下書きを読む点）を書き足す必要がある。
