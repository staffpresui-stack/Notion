# 旧マイドライブ代用構成のingestInbox検証

この手順は旧staff.presuiの代用構成を記録したものです。現在のfinance@・共有ドライブでは [共有ドライブ手順](SHARED_DRIVE_TEST.md) を使い、このページのマイドライブ準備は実行しません。

今回のGAS実行はユーザーが行います。CodexはGoogle・Notion・Chatworkへの実書き込みを行っていません。
共有ドライブは社内確認待ちのため使いません。作成先はstaff.presuiのマイドライブに用意する開発専用フォルダだけです。

## 1. GASを更新する

`staff.presui@gmail.com` の本体開発プロジェクトで、workブランチの次のファイルを反映します。

- `dist/gas-core/Code.gs`：ダウンロードし、コード.gsを全文置換します。
- `dist/gas-core/appsscript.json`：プロジェクト設定でマニフェスト表示を有効にし、内容を置き換えます。Drive v3と、Drive・スプレッドシート・ドキュメント・外部リクエストのスコープを含みます。
- エディタ左の「サービス」に **Drive API v3** があることを確認し、なければ追加します。標準Cloudプロジェクトを使う場合はGoogle Cloud側のDrive API有効化も必要です。

コードにDocumentAppを追加したため、実行時にGoogleの権限確認が再表示されることがあります。内容を確認して許可します。Webアプリのデプロイや時間トリガーはまだ不要です。

## 2. スクリプトプロパティ

| プロパティ | 設定 |
|---|---|
| ENV | `test` |
| DRY_RUN | 最初は `true` |
| NOTION_TOKEN | 設定済み「MTG議事録連携（GAS）」のトークンを維持 |
| NOTION_DB_MINUTES_TEST | `d9cc47f9-543e-4bcb-8ec8-27bebc0feac5` |
| NOTION_DB_TASKS_TEST | `c908936a-6999-4119-9e9c-df364f5f5d1b` |
| NOTION_DB_TLDV_INBOX | `400ca178-7419-80dd-a3e0-ef9e2267a64c` |
| SETUP_CREATE_TEST_DB | `false` のまま |
| NOTION_REQUESTER_TYPE | `people`（省略時も同じ） |
| INGEST_BATCH | `5`（1〜10、省略時5） |
| SHARED_DRIVE_ID | 未設定または空欄 |
| CHATWORK_TOKEN | 未発行のため未設定のまま |
| CHATWORK_ROOM_ID_TEST | トークン未設定なら不要 |

`TEST_ENV_KEY`・`FOLDER_SYSTEM_TEST_ID`・`LEDGER_SPREADSHEET_ID` は準備関数が自動登録します。既存の別環境の値がある場合は上書きせず停止します。
`NOTION_FIXTURE:*` の記録は残してください。

## 3. tl;dv受信DBの不足選択肢を追加

1. `DRY_RUN=true` で **`addTldvInboxStatusOptions`** を実行します。追加予定だけを表示します。
2. `DRY_RUN=false` で同じ関数を実行します。不足する「未処理／取り込み済み／対象外（Meet優先）／エラー」だけを追加します。
3. **`checkTestEnvironment`** を実行し、差分一覧を確認します。既存の独自選択肢は削除しないため、残っていれば参考差分に表示されます。

既存の選択肢ID・名前・色を含めて更新し、変更や削除は行いません。同時に別の人が選択肢を編集しない状態で実行してください。再実行して不足がなければ更新しません。
既知のタスク追加項目3件は差分ではなく別ログへ表示します。依頼者はpeopleを仮の既定として照合し、NOTION_REQUESTER_TYPEでrich_text／emailにも切り替えられます。タスクへの書き込みは行いません。

## 4. テスト用フォルダ・台帳・サンプルを準備

`DRY_RUN=false` のまま、次の順で実行します。

1. **`setupTestWorkspace`**：マイドライブに `MTG議事録自動化（開発専用）/_system/_test` とテスト台帳を作ります。
2. **`seedFixtureInbox`**：判定JSON・議事録Doc・manifest・ダミー文字起こしを3件投入します。

準備される構成：

```text
MTG議事録自動化（開発専用）/_system/_test/
  00_受信/{folder_key}/manifest.json・ダミー文字起こしDoc
  inbox/{folder_key}.json・議事録Doc
  inbox/_done/
  社内/{部署}/
  社外/サンプル商事様/
  00_仕分け待ち/
  99_対象外/_空/
  ref/
  MTG議事録 台帳（テスト）
```

台帳にはSPECの10シートと見出しを作成します。既存の初期シートがあれば削除しません。
部署・サンプル顧客・社員マスタは提供fixturesを元に追加します。既存の同一キーのマスタや見出しを上書きしません。準備関数の再実行で同じフォルダ・台帳・マスタを増やさないことをローカルで検証しています。
サンプル投入も同名ファイル・処理済み会議を再作成しません。本物のMP4や文字起こしは使用せず、Meetのmanifestは録画・Geminiメモをmissingとして記録します。

## 5. DRY_RUNで取り込み予定を確認

**`DRY_RUN=true`** に戻し、**`ingestInbox`** を実行します。

JSON Schemaに沿って検証し、manifest・ファイルの所属を確認して、規則判定・食い違い・格納先を計算します。
台帳の `dry_run_log` と実行ログに取り込み・Notion・Chatworkの予定を記録します。minutes行追加・ファイル移動・Notion作成・重複防止プロパティ更新は行いません。
想定判定は **確認待ち／確認待ち／仕分け待ち** です。

## 6. テスト環境で取り込む

**`DRY_RUN=false`** に変更して、**`ingestInbox`** を実行します。終了後は **`DRY_RUN=true` に戻します**。

期待する結果：

- 台帳のminutesに3行ができ、日付別のdisplay_idが付きます。
- 社内・高は「社内/Salesforce・AI」、社外・高は「社外/サンプル商事様」、低確信度は「00_仕分け待ち」に会議フォルダを作ります。
- 生データ・議事録Doc・manifestを会議フォルダへ移動します。コピーや削除はしません。
- 空になった受信フォルダは `99_対象外/_空` へ、判定JSONは `inbox/_done` へ移動します。受信フォルダに追加ファイルが残る場合は動かさずログに残します。
- 前回作った同じmeeting_keyのNotion3ページは、NOTION_FIXTURE記録で所属確認して再利用します。新たに3ページを増やしません。台帳のnotion_statusは「作成済み（再利用）」になります。
- 新しいmeeting_keyを投入した場合だけ、確認済みテスト議事録DBへページを作成します。Docの見出し・段落・箇条書き・番号付き・表をNotionブロックに変換し、100ブロック単位で作成・追記します。
- Chatworkトークンがないため実投稿せず、投稿予定を実行ログと `dry_run_log` に残します。message_idは空、step_done_jsonのchatworkはlog_onlyになります。
- change_logに取り込みを記録し、再実行で同じ行・フォルダ・ページを二重に作りません。

タスク提案はログ表示のみです。確認画面は未公開のため、Chatwork予定には「確認画面はまだ公開していません」と表示します。録画・Driveリンクはカードに載せません。

## 失敗時と再開

- 各段階の完了は台帳のstep_done_jsonに保存します。ファイル移動済みでも再実行で続きを処理できます。
- Notion作成が403ならnotion_status=Notion保留とし、Drive処理・カード予定・JSONの_done移動を継続します。権限が直った後、DRY_RUN=falseでingestInboxを再実行すると、台帳から保留分を拾ってNotion部分を再試行します。
- JSON不正などはstatus=要対応、last_errorへ理由を記録します。同じ未変更ファイルを毎回処理して他の会議を妨げないよう、エラーは再検査待ちにします。
- 原因を直したら **`retryInboxErrors`** をDRY_RUN=falseで実行し、続いてingestInboxを実行します。変更済みJSONは更新時刻の変化でも再検査対象になります。
- Notion作成・本文追記・Chatwork投稿の結果が通信中断で不明な場合は、自動で同じ操作を繰り返しません。実サービスとログを照合してから記録を整える必要があります。pending記録を確認なしに削除しないでください。
- 本文の途中で4分を超えた場合は進捗を保存し、次のingestInbox実行で続きを処理します。初期値のINGEST_BATCHは5件です。
- token未設定でlog_onlyになったカードは、後からtokenを入れても過去分を自動投稿しません。今はログ動作だけを検証します。

## 制限と検証範囲

今回の実装はENV=test専用で、マイドライブの専用マーカー配下だけを操作します。ルート外・削除済み・ショートカットを拒否します。SHARED_DRIVE_IDなしをENV=prodで許可しません。
本番Notionへの作成は禁止です。tl;dv受信DBへの更新は指定の4選択肢の追加だけを許可します。共有ドライブの権限確認・GAS-B・自動生成・トリガー・確認画面はまだ別段階です。
通常のMTG URL設定はこの検証では空です。Notionプロパティへ送らない選択肢・存在しない関連PJはログへ出します。
Google Drive・DocsとNotionの公式仕様、以前確認した2025-09-03対応SDKを参照しています。Chatwork公式サイトへの接続は403で、実APIの送信は未検証です。今回はトークン無しのログ経路をテストします。
