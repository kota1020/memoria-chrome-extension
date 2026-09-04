# memoria for Chrome

見ているページの**正確なURL・正確なタイトル・本文・滞在時間**を、
このMacの中で動く memoria へ渡すだけの拡張機能。

## なぜ要るか

memoria は画面を撮って OCR で読んでいる。ブラウザの中身はそれだと当たらない。
`kota/activity-log.jsonl` の直近2,261行を数えた実測（2026-09-04）:

- **1,409行が `src: "OCR"`。ブラウザから直接もらった行は 0**
- タイトルの **311件が「…」で切れている**（ウィンドウのタイトルバーを読んでいるため）
- 本文はこうなる:

  ```
  title: "Memoria Context Faucet -…"
  ctx:   "...... · Nunrau Cumael Pwvsy. · -.м..• · N -..... · Avire · ENSAC 9A322 a."
  ```

同じページを、この拡張機能を入れて記録するとこうなる:

```
2026-09-04T04:53:26.890Z  5s  記憶 - Wikipedia
    https://ja.wikipedia.org/wiki/%E8%A8%98%E6%86%B6
    本文 10506字  区切り: unload
```

推測が実測に置き換わる。同じ時刻の画面フレームと突き合わせれば、
「その画面で何を見ていたか」が確定する。これがこの拡張機能の唯一の役目。

## 渡すもの

1件の「滞在」ごとに、次を1つのJSONにして渡す。

```json
{
  "v": 1,
  "source": "chrome-extension",
  "extension_version": "2.0.0",
  "sent_at": "2026-09-04T04:53:38.000Z",
  "events": [
    {
      "kind": "view",
      "url": "https://ja.wikipedia.org/wiki/記憶",
      "title": "記憶 - Wikipedia",
      "lang": "ja",
      "referrer": "",
      "text": "…本文（最大20,000字）…",
      "text_chars": 10506,
      "text_skipped": null,
      "entered_at": "2026-09-04T04:53:26.890Z",
      "left_at": "2026-09-04T04:53:31.900Z",
      "dwell_ms": 5010,
      "reason": "unload",
      "tab_id": 12
    }
  ]
}
```

- 宛先: `POST http://127.0.0.1:4319/ingest/page`
- `reason` は滞在が閉じた理由（`hidden` / `unload` / `navigate` / `heartbeat` / `blur`）
- `text_skipped` は本文を取らなかった理由（`password_field` / `denylist`）
- 見えている時間だけ数える。裏に回したタブの時間は入らない
- 60秒より長い滞在は途中でも一度区切って渡す（開きっぱなしを取りこぼさないため）

## 読み取らないもの

- **パスワード欄があるページの本文**（設定に関係なく常に）
- 入力欄・フォームに入力した値
- 利用者が除外に入れたサイト
- シークレットウィンドウ（Chromeの既定で拡張機能が動かない）

送信先は `127.0.0.1` のみ。設定画面でもそれ以外は保存できない（コードで拒否）。

## 動かしてみる

受け口の代わりに、同じ形で受けるだけのダミーを同梱してある。

```sh
node tools/mock-memoria-ingest.mjs          # http://127.0.0.1:4319 で待ち受け
PORT=4399 node tools/mock-memoria-ingest.mjs
```

1. `chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」でこのフォルダを選ぶ
2. 上のダミーを起動する（既定以外のポートにしたときは、拡張の設定で送信先を変える）
3. 適当なページを見る。ダミーの標準出力に、渡された内容がそのまま出る

## 構成

| ファイル | 役目 |
|---|---|
| `content.js` | 見ているページから1件の「滞在」を作る（ISOLATED world） |
| `background.js` | 溜めて、まとめて 127.0.0.1 の memoria へ渡す |
| `popup.html/js` | オン・オフ、渡した件数、つながっているか |
| `options.html/js` | 本文を渡さないサイト、何も渡さないサイト、送信先 |
| `tools/mock-memoria-ingest.mjs` | 受け口のダミー |

## memoria 本体側

`POST /ingest/page` を受けて `kota/activity-log.jsonl` に `src: "extension"` として
書き込む口が要る。ここはこのリポジトリの範囲外。

## 公開者

Kotaro Murakami / kotaro.murakami@infozerogrid.com
