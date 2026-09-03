// ============================================================================
//  background.js（Chrome Web Store 配布ビルド・MV3 service worker）
//
//  やることは1つだけ。拡張アイコンを押したらサイドパネルを開く。
//  ここには通信もデータ処理も無い。記憶の問い合わせはサイドパネル側が
//  このMacの中の Memoria 読み取りAPI（127.0.0.1:4319）へ直接行う。
//
//  入れていないもの: nativeMessaging / ページや会話の取り込み /
//                    content script / 外部サーバーへの通信
// ============================================================================

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}
