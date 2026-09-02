# Memoria Chrome Extension

Chromeで開いているページに関係するMemoriaの記憶を、サイドパネルで思い出す拡張機能です。

## できること

- ページタイトル・ドメイン・ユーザーが選択した文字から、Memoriaの関連カードを検索
- 現在のタスクとfactsを確認
- Claude / ChatGPT / Geminiへの既存の確認付きhandoff
- ページ本文・生OCR・外部サーバーへの送信は行わない

Memoriaのローカルread API（既定 `http://127.0.0.1:4319`）が起動している必要があります。

## ローカルで試す

1. `extension/` を `chrome://extensions` の「パッケージ化されていない拡張機能を読み込む」から読み込む
2. Memoria read APIを起動する
3. 拡張アイコンを押してサイドパネルを開く

## 公開者

Kotaro Murakami (`kotaro.murakami`)

## Privacy

この拡張は、ユーザーが現在閲覧中のページに関係する記憶をローカルMemoriaから表示する目的だけで、ページタイトル・ドメイン・選択テキストをローカルAPIへ送ります。外部クラウドへ送信せず、拡張側に閲覧履歴を保存しません。詳細は [PRIVACY.md](PRIVACY.md) を参照してください。
