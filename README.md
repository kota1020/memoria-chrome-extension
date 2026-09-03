# Memoria Chrome Extension

Chromeで開いているページに関係する Memoria の記憶を、サイドパネルで思い出す拡張機能。

このリポジトリには**2つのビルド**が入っている。混ぜないこと。

| | 中身 | 用途 |
|---|---|---|
| **開発版**（リポジトリ直下） | サイドパネル ＋ AI入力欄への記憶の受け渡し ＋ 会話の取り込み（nativeMessaging） | 自分のMacで `chrome://extensions` から読み込んで使う |
| **配布版**（`store/` → `dist/store/`） | サイドパネルだけ | Chrome Web Store へ出すもの |

配布版に会話の取り込みと nativeMessaging を入れていないのは、Memoria本体を持たない一般の利用者に対して
動かない上に、要求する権限だけが大きくなるため。要求するホスト権限は `http://127.0.0.1:4319/*` の1つだけ。

## 配布版をつくる

```sh
node scripts/build-store.mjs
```

`dist/store/` と `dist/memoria-context-faucet-<version>.zip` ができる。
このスクリプトは ZIP を作る前に、manifest に `key` や広いホスト権限が残っていないか、
nativeMessaging や MAIN world への注入が混ざっていないか、外部の通信先が入っていないか、
アイコンの実寸が正しいかを見て、1つでも引っかかれば止まる。

申請フォームの記入内容は [STORE-LISTING.md](STORE-LISTING.md)、
プライバシーポリシーは [PRIVACY.md](PRIVACY.md)、掲載画像は `store-assets/`。

## Memoria を持っていない状態で動かしてみる

読み取りAPIの代わりに、同じ形の応答を返すだけのダミーを同梱してある。

```sh
node tools/mock-memoria-api.mjs        # http://127.0.0.1:4319
PORT=4399 node tools/mock-memoria-api.mjs
```

止めた状態でサイドパネルを開くと、「つながっていないこと」と直し方だけが表示される。
これが Memoria を持っていない利用者に見える画面。

## この拡張が読むもの（配布版）

サイドパネルを開いている間の、現在のタブのタイトル・ホスト名・利用者が選択したテキストだけ。
送信先は `http://127.0.0.1:4319` の1本のみ。ページ本文は読まず、外部へは何も送らない。
詳細は [PRIVACY.md](PRIVACY.md)。

## 開発版を読み込む

1. `chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」でリポジトリ直下を選ぶ
2. Memoria の読み取りAPI と、ネイティブメッセージングホスト
   （`com.zerogrid.memoria.browserhost`）を起動しておく
3. ツールバーのアイコンでサイドパネルを開く

## 公開者

Kotaro Murakami / kotaro.murakami@infozerogrid.com
