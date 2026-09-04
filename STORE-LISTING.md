# Chrome Web Store 申請フォーム記入内容（2.0.0）

**注意: 2.0.0 は 1.0.0（Memoria Context Faucet／サイドパネル）とは別の製品**。
同じ掲載枠を作り替えて出す前提で書いてある。名前・説明・スクリーンショットを全部入れ替える。

---

## Store listing

### Name

```
memoria for Chrome
```

### Summary（最大132文字）

```
見ているページの正確なURL・タイトル・本文・滞在時間を、あなたのMacの中で動くmemoriaへ渡します。外部サーバーへの送信はありません。
```

### Description

```
memoria for Chrome は、いま見ているページを、あなたのMacの中で動く memoria へ「正確な形で」渡すための拡張機能です。やることはこれだけです。

■ なぜ要るか

memoria は画面を撮って文字認識（OCR）でブラウザの中身を読もうとします。しかしこれはほとんど当たりません。実際の記録では、ページの本文が「Nunrau Cumael Pwvsy.」のような読めない文字列になり、タイトルも「Memoria Context Faucet -…」のように途中で切れます。

ブラウザ自身が値を渡せば、この推測が実測に置き換わります。

■ 渡すもの

・ページの正確なURL
・ページの正確なタイトル（省略なし）
・ページの本文テキスト（最大20,000文字）
・そのページが画面に見えていた時間（開始・終了・秒数）

■ 渡さないもの

・パスワード入力欄があるページの本文。ログイン画面・銀行・決済などは、設定に関係なく本文を読み取りません
・入力欄やフォームに入力した値
・あなたが除外に登録したサイト
・シークレットウィンドウの情報

■ 送信先

あなたのMacの中の memoria だけです（既定 http://127.0.0.1:4319）。これはループバックアドレスで、通信は端末の外へ出ません。設定画面でも 127.0.0.1 以外は保存できません。外部サーバー、当方のサーバー、クラウド、広告・解析サービスへは一切送信しません。リモートのコードも読み込みません。

■ 止め方

ツールバーのアイコンからいつでもオフにできます。オフの間は一切読み取りません。サイト単位で「本文だけ渡さない」「何も渡さない」も設定できます。

■ 動作条件

あなたのMacで memoria が動いていることが前提です。動いていない場合、記録は最大200件だけ手元に待たせ、繋がった時に渡します。ブラウジングの妨げにはなりません。memoria を持っていない方が入れても、害はありませんが、渡す先がありません。

■ ソースコード

https://github.com/kota1020/memoria-chrome-extension
```

### Category / Language

```
Workflow & Planning / 日本語 (Japanese)
```

### Support URL / Homepage URL

```
https://github.com/kota1020/memoria-chrome-extension
```

### 掲載画像（未作成・要差し替え）

1.0.0 のスクリーンショットはサイドパネルのもので、2.0.0 では使えない。撮り直しが要る。

- ポップアップ（オン・オフと渡した件数）
- 設定画面（除外するサイト）
- OCR の記録と、この拡張機能が渡す記録の並べた比較

---

## Privacy

### Single purpose

```
利用者が閲覧しているページの正確なURL・タイトル・本文・滞在時間を、利用者自身の端末上で動作する
memoria へ渡すこと。
```

### Permission justification

| 権限 | 文面 |
|---|---|
| `storage` | 利用者の設定（オン／オフ、除外サイト、送信先）を保存するため。ページの内容は保存しない。 |
| `alarms` | 送信先の memoria が起動していない間に溜まった記録を、定期的に渡し直すため。 |
| ホスト権限 `http://127.0.0.1:4319/*` | 利用者自身の端末で動作する memoria へ渡すため。ループバックアドレスであり端末外への通信は発生しない。これ以外のホスト権限は要求していない。 |
| コンテンツスクリプト `http://*/*` `https://*/*` | 「どのページをどれだけ見ていたか」を記録することが本拡張機能の単一目的であるため、対象サイトを限定できない。ページの表示・動作は一切変更せず、DOMへの書き込みも行わない。パスワード入力欄があるページでは本文を取得しない。 |
| リモートコード | 使用していない。すべてのコードはパッケージに同梱されている。 |

### Data usage

チェックする項目:

- **Website content** — ページの本文テキスト
- **Web history** — URL、タイトル、閲覧時刻、滞在時間

チェックしない項目: 個人を特定できる情報 / 健康情報 / 金融情報 / 認証情報 /
個人的なやり取り / 位置情報 / ユーザーの操作履歴

補足として貼る文面:

```
取得したデータの送信先は、利用者自身の端末上の 127.0.0.1 のみで、外部サーバーへは一切送信しない。
拡張機能側での永続保存もしない（一時的な送信待ち行列のみ）。パスワード入力欄があるページでは
本文を取得しない。利用者はいつでも全体をオフにでき、サイト単位の除外も設定できる。
```

### Privacy policy URL

```
https://github.com/kota1020/memoria-chrome-extension/blob/main/PRIVACY.md
```

---

## Test instructions（英語で貼る）

```
This extension sends the page you are viewing to memoria, a local-only personal memory service
running on the user's own machine. It only ever talks to http://127.0.0.1:4319 on the machine it
is installed on. It never contacts any remote server. No account, login, or payment is required.

Because that local service is not part of the package, this repository ships a stub that receives
the same payload and prints it, so the behaviour can be reviewed end to end:

  1. git clone https://github.com/kota1020/memoria-chrome-extension
  2. node tools/mock-memoria-ingest.mjs      (Node.js 18+, listens on http://127.0.0.1:4319)
  3. Load the extension and browse to any page, then switch tabs or close it.
     The stub prints the URL, title, character count of the page text, and dwell time.
  4. Open a page that has a password field (for example https://github.com/login).
     The stub shows "text_skipped: password_field" - the page body is not captured.
  5. Open the extension popup and turn it off. Browsing produces no further records at all.
  6. Stop the stub. Browsing continues normally; records wait in memory (max 200) and are
     delivered when the stub is started again.
```
