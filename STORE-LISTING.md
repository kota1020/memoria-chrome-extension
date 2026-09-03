# Chrome Web Store Listing Draft

## Store title

Memoria Context Faucet

## Short description

今開いているページに関係するMemoriaの記憶を、確認つきで思い出します。

## Detailed description

Memoria Context Faucetは、現在のページに関係するあなたの記憶・判断・タスクを、Chromeのサイドパネルで確認できる拡張機能です。

ページ本文を収集するのではなく、ページタイトル、ドメイン、ユーザーが明示的に選択したテキストだけを検索手がかりにして、ユーザー自身のMac上で動くMemoria read APIから関連カードを表示します。

主な機能:

- 現在のページに関連する記憶カードの表示
- 現在のタスクとfactsの確認
- Claude / ChatGPT / Geminiへの確認付きhandoff
- ローカルファースト設計。外部クラウドへの送信なし

利用には、ユーザーのMac上でMemoria read API（既定 `127.0.0.1:4319`）が稼働している必要があります。APIが停止していても、ブラウジング自体は妨げません。

## Single purpose

現在のWebページに関係するユーザー自身のMemoriaコンテキストを、Chromeサイドパネルで確認・再利用できるようにする。

## Permission justifications

- `activeTab`: ユーザーが拡張機能を開いた現在のタブから、ページタイトルと明示選択テキストを取得するため。
- `scripting`: 選択テキストを取得する短い関数を現在タブで実行するため。ページ本文は取得しない。
- `tabs`: 現在タブのタイトルとURLのホスト名を表示・検索手がかりにするため。
- `sidePanel`: Memoriaコンテキストをサイドパネルで表示するため。
- `host_permissions`（AIサイト）: 既存の確認付きhandoffをClaude / ChatGPT / Geminiで動かすため。
- `host_permissions`（127.0.0.1:4319）: ユーザー自身のMac上のMemoria read APIへ接続するため。
- `nativeMessaging`: 既存のローカルブラウザキャプチャ連携を、ユーザーが設定した場合にのみ動かすため。

## Data use disclosure

Collected data is limited to page title, hostname, and user-selected text when the side panel is opened. It is used only to query the user's local Memoria API and is not sold, advertised against, or sent to external cloud services. The extension does not collect page body text, passwords, form values, cookies, audio, or screen recordings.

## Support

GitHub: https://github.com/kota1020/memoria-chrome-extension

Publisher: Kotaro Murakami (kotaro.murakami)
