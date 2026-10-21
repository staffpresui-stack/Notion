# Google一時エラーの再試行・反映手順

4c27762のGAS-A反映後、テストルートのDrive.Files.getがInternal Errorで断続的に失敗するとの実機報告への対応です。IDやfieldsの変更はせず、Drive/Docsの共通再試行を追加しました。Google側の障害が原因かは、この開発環境からは確定していません。

## 変更

- GAS-A/BのDrive.Files.get/list/update/createとDocs.Documents.getは、共通の`GoogleApi_`を通します。原本は`shared/googleApi.js`、各GASのgenerated.jsとdistはbuildで生成します。
- 5xx、Internal Error、Backend Error、rate limitだけ、**初回＋最大4回再試行**。待機は500→1000→2000→4000ミリ秒（合計7.5秒）。403のrateLimitExceeded/userRateLimitExceeded、429も対象。権限不足・404・不正値・日次上限などは対象外です。通常成功時の待機はありません。
- 更新は同じIDへ同じ内容を置換。移動の応答失敗時は、現在の親を取り直して完了済みのaddParents/removeParentsを除きます。DRY_RUN・テスト範囲・操作者の制限は従来どおりです。
- フォルダ/JSON/TXT等の作成はDriveの事前発行IDを保持し、同じIDで再送します。成功済みならIDと作成目印・名前・型・親を照合して再利用。作成済み応答が失われても別IDを作りません。
- Google Doc/Sheetsや変換インポートはGoogleの仕様で事前IDに非対応です。5xx等で結果が曖昧なら、作成目印を共有ドライブの一覧から最大4回待って照合し、**見つからなくてもcreateを再送しません**。明示的な403 rate limit/429で作成が拒否された場合だけ再送できます。照合にも所属・名前・型を使います。
- 作成処理のID/目印/本文ハッシュはスクリプトプロパティ`GOOGLE_CREATE_PENDING:*`へ自動記録し、成功・照合完了時に消します。結果不明時は残し、次の実行でも同じID/照合を続けます。本文が変わった場合は停止します。既存のNotion等の冪等記録は維持します。
- 再試行ログは操作名・回数・待機時間だけ。会議本文・トークン・ファイルID・エラー原文は共通ラッパーからログに出しません。

## finance@で反映

1. **GAS-A**のCode.gsを`dist/gas-core/Code.gs`で全文置換。dev.gsは残します。今回appsscript.json・サービス・OAuthスコープの変更はありません。前回反映したDocs v1は維持します。
2. プロパティは現在の`ENV=test`、`DRY_RUN=true`、`GENERATOR_MODE=LOCAL_CODEX`と既存IDをそのまま維持。追加するプロパティはありません。新しい`GOOGLE_CREATE_PENDING:*`も手動作成しません。
3. `exportTranscriptTexts()`、次に`ingestInbox()`を実行。Googleの一時エラーを受けた場合は「500ミリ秒後に再試行…」と表示され、回復すれば処理が続きます。エラーが出ない正常時には再試行ログは出ません。DRY_RUNなので業務ファイル作成・移動は行いません（既存のdry_run_log動作は維持）。対象会議が無い場合、予定が0件でも正常です。
4. **GAS-B**にも同じ保護を入れる場合、Code.gsを`dist/gas-organizer/Code.gs`で全文置換。manifestやスコープ変更は不要です。BもDRY_RUN=trueのまま`checkOrganizerConfig()`、必要なら`moverRun()`で読取を確認します。今回のAの問題だけ先に確認するなら、Bの反映は後でも構いません。
5. エディタから実行する関数と時間トリガーは保存済みコードを使います。既存Webアプリの画面にも再試行を反映する場合だけ、A/Bそれぞれ「デプロイを管理」→編集→新バージョンで更新。同じURLを維持し、表示が古ければ強制再読み込みします。

今回CodexはGASの実行・設定変更・Google/Notionへの書き込みを行っていません。通常の読取を確認するためにDRY_RUNをfalseにする必要はありません。

## 止まった場合

- 最終試行までInternal/Backend等が続けば、元のエラーで停止します。恒久障害を成功扱いにはしません。Google側の状態を確認し、時間をおいて人が再実行してください。
- 「Drive作成結果を確認できません…保留」と出た場合は、`GOOGLE_CREATE_PENDING:*`を消さず、対象フォルダの同名ファイル・作成IDを確認します。共通ラッパーまで到達した次の実行は同じ予約IDか目印で照合し、二重作成を防ぎます。exportRef等の既存の保留チェックが先に止める場合も、その記録を維持して人が確認します。Docの結果が最後まで不明な場合は人の確認が必要です。既存のNotion/台帳/処理済み記録もリセットしません。
- 403権限/404等は再試行しません。finance@の権限・共有ドライブ所属・設定IDを確認します。

## PCの状況

ユーザー報告：候補MacはmacOS 15.7、Driveパソコン版は別アカウントでログイン中、finance@未追加、Codex CLI未導入。常時実行するPCは社内で選定中です。今回PCの設定変更・CLI導入・finance@追加は行っていません。PC決定後は`LOCAL_CODEX_TEST.md`に従って手動試験から進めます。

## 根拠と検証

Google公式の[Driveエラーと指数バックオフ](https://developers.google.com/workspace/drive/api/guides/handle-errors)、[事前発行ID・409とGoogle Workspaceファイルの制限](https://developers.google.com/workspace/drive/api/guides/create-file#generate-ids)を本文で確認。ローカル165件のテスト・build/check/smokeが成功。一時障害・4xx即停止・回数上限・共有ドライブの最初のmeta・DRY_RUN・作成成功後の応答失敗・ID非対応の保留・本文変更・移動済みの再試行をモック検証します。Google実機の不安定さ自体は再現できていません。
