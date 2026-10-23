# テスト環境の無人運転

## 到達点と構成

ユーザー実機で2026年10月22日、26bd4d4のLOCAL_CODEX通しが合格。テスト会議4はMTG-261022-01としてDoc/Notionを作成済み。Macのlaunchdは15分間隔、ログは~/pmode-minutes/logs/に設定済みです。既存の会議・ファイル・台帳・重複防止記録は維持します。

今回、正常な会議は「Bが自動検出→AがTXT出力→MacがJSON保存→AがDoc/Notionへ取り込み」まで定期実行します。**ENV=testのままです。本番切替ではありません。** 初回だけ設定・認証・トリガー登録が必要で、会議ごとに関数を実行する必要はありません。判定の確認・修正は従来の画面で行います。正常時に自動で議事録を作ることと、人が内容を確定することは別です。

## 1. 反映と一度だけ行う準備

### GAS-B（finance@）

1. dist/gas-organizer/Code.gsとRegister.htmlを反映。appsscript.json・サービス・スコープの変更なし。
2. 次のプロパティを設定。既存の共有ドライブ・_testのIDは維持します。

| キー | 無人テストの値 | 説明 |
|---|---|---|
| ENV | test | prodを使わない |
| DRY_RUN | trueで設定確認後、falseを維持 | 自動移動を実行するため必要 |
| MOVER_MODE | AUTO | 未指定は従来のTEST_EVENT。AUTOはMOVER_TEST_EVENT_ID不要 |
| MOVER_WAIT_MIN | 20 | 終了後、添付の生成を待つ分数 |
| MOVER_INTERVAL_MIN | 15 | 主催者の定期実行間隔 |
| MOVER_MEMO_WAIT_MIN | 120 | 文字起こしがない場合のメモ利用待機。20〜2880分。B/Aに同値を設定 |

3. BのWebアプリを既存URLの新バージョンで更新。実行は「アクセスしているユーザー」、今回の利用者はfinance@だけ。強制再読込しAUTO表示を確認。DRY_RUN=trueなら登録予定の表示だけです。falseにした後、finance@本人で一度「登録」を押し、moverRunトリガーが1個であることを確認。**無人運転中は登録解除しません。** 前回テスト終了時に解除済みなら再登録が必要です。間隔変更時だけ解除→再登録します。

AUTOの対象は登録本人が主催・Meet付き・終了後MOVER_WAIT_MIN経過・終了が直近72時間内の予定です。参加者として招待された会議、キャンセル、終日、非公開（visibility=private）、タイトルに正確な`【記録なし】`を含む予定は対象外。録画・メモ・文字起こしのどれも判定できない予定は静かに対象外です。AUTOを有効にすると条件に合う過去72時間の実会議も対象になるため、先にカレンダーで除外指定を確認してください。

録画は必須ではありません。文字起こしがあればそれを優先。文字起こしがなく、待機時間後にGeminiメモがあればメモを採用します。録画だけでメモも文字起こしも無ければ要確認としてBの結果・登録受け渡しに残し、動画をAIへ送って補完しません。1件のエラーでも他の予定を継続、1回約4分まで、処理済みキーは維持します。

### GAS-A（finance@）

1. dist/gas-core/Code.gsを全文反映。dev.gsは残す。スコープ・サービスの追加なし。前回のDocs v1を維持します。Web画面にも新コードを反映する場合は既存デプロイを新バージョンへ更新します。
2. 既存のtest IDs・NOTION_TOKENを維持して以下を設定。

| キー | 値 |
|---|---|
| ENV | test |
| GENERATOR_MODE | LOCAL_CODEX |
| DRY_RUN | trueで予定確認→falseを維持 |
| MOVER_MEMO_WAIT_MIN | 120（Bと同値） |
| GENERATOR_TIMEOUT_MIN | 120（15〜1440、TXT出力後の遅延閾値） |
| LOCAL_FAILURE_ALERT_COUNT | 3（1〜20、直近4時間の連続失敗） |
| CHATWORK_TOKEN | 未設定のままで可 |

3. `setupAutomationTrigger()`をtrueで実行し予定を確認。falseにして同関数を一度実行。automationTick_が15分ごとに1個できます。自分の旧transcriptExportTick_だけ自動解除し、他のトリガーは変更しません。繰り返し設定しても増えません。**旧setupTranscriptExportTriggerを後から再登録しないでください。**
4. 自動処理は1つのLedgerロック内でTXT出力→ingestInbox→停止監視。TXT段階の一部の会議が要確認でも他会議・取り込みへ進みます。取り込みは全体約4分までの残時間を使います。安全に再検査できる要対応行は15分おきに再試行し、新着を優先します。Notion作成応答不明・本文追加応答不明・Chatwork送信応答不明は自動再送せず要対応で知らせます。
5. 参照ファイルの定期更新が未登録なら、`setupRefExportTrigger()`もtrue→falseで一度設定（毎朝6時台）。B登録の台帳同期を使うなら既存`setupOrganizerSyncTrigger()`を設定。これらは統合トリガーと別用途です。

これ以降、無人運転中はA/BともDRY_RUN=false・ENV=testを維持します。trueへ戻すと予定表示だけになり、自動化は進みません。今回の無人テスト方針に従った設定で、本番承認を意味しません。

### 川戸Mac

1. PCのworkを最新に更新し、local/run.cjsとprompts/codex_local_task.mdを反映。必要ならnpm ci。既存launchdのパス・StartInterval=900・~/pmode-minutes/logs/は維持します。実際に更新したrun.cjsのパスをlaunchdが参照していることを確認。今回はCodexのログイン方法・権限を変更しません。
2. PCログイン・常時稼働・Drive同期・finance@接続・Codex Plus認証が必要です。省エネ設定で実行中にスリープしない運用を決めます。スリープ/電源オフ中は実行できません。
3. 新runnerは毎回、_test/_local_codex/status_*.jsonへ成功/失敗・日時だけを新規保存。認証失敗やロック残留を含め、runnerで捕捉した失敗も記録します。本文・秘密値は含めません。既存のファイルは上書きしません。Driveが完全に切断されて記録を同期できない場合は、GASのTXT経過時間で検知します。Codex認証期限が切れた場合の再ログインは人が必要です。

## 2. 文字起こしなしの扱い

Meetで**「会議を文字起こし」をオン**にしないと、Geminiメモの文字起こしタブは作られないことをユーザー実機で確認済みです。録画とGeminiメモのオンだけでは不足します。

待機後にメモを使う場合、manifest.transcript_source.type=gemini_notes、input_quality=notes_only。TXTのファイル名は互換性のためtranscript.txtを維持しますが、内容はメモであり原文ではありません。ローカル指示文・runner・GAS-Aでこの区別を適用し、Doc/Notionの本文・要確認・判定理由と台帳last_error/step_done_jsonへ**「文字起こしなし・メモから作成」**を残します。確信度は低、従来の仕分け待ちへ回します。発言の原文として引用せず、推測で担当や期日を補いません。

メモのタブが複数で一意に選べない、本文が空、読み取り不能なら要確認として停止・監視ログへ記録します。元Doc・既存TXTを上書きせず、既存TXTの固定スナップショットは更新しません。後から文字起こしが生成されても、処理済み会議を二重作成・自動差し替えしません。

## 3. 停止に気付く仕組み

Aの15分tickで、次をテスト台帳のchange_log（停止検知/停止検知解除）とdry_run_log（Chatwork通知予定）に記録します。同じ障害中は通知を繰り返さず、解消後の再発は再通知します。

- TXTのexported_atからGENERATOR_TIMEOUT_MINを過ぎても有効なJSON＋完了印がない。Mac停止、認証切れ、同期途中を含みます。
- 有効JSONが届いていても取り込みが完了していない、台帳が要対応/Notion保留/結果不明。
- runnerの成功を挟まずLOCAL_FAILURE_ALERT_COUNT回失敗（直近4時間の同期済みstatus）。
- TXT出力段階・取り込み段階が要確認で止まった。

**今回の監視ChatworkはENV=testではトークンがあっても予定ログだけです。** 実投稿はしません。既存ingestの確認カードの扱いは従来どおりで、トークンなしなら予定ログだけ。change_logとdry_run_logは、試験担当者が確認します。GAS自体のトリガー停止やGoogle全体の障害を、この同じGASだけで外部通知することはできません。GASのトリガー失敗メールもfinance@で受信確認してください。本番では独立した監視と実Chatwork通知が必要です。

## 4. 手で関数を実行しない通し試験

一度だけの設定・登録を終えたら、次の試験中はmoverRun/exportTranscriptTexts/ingestInboxを手動実行しません。既存MTG-261022-01や処理済み記録を消さず、新しい予定を作ります。

1. finance@本人主催、Meet付きの短い新規会議を作成。「会議を文字起こし」・録画・Geminiメモをオンにして終了。参加者として招待される会議では試さない。
2. Bの15分トリガーが終了後20分＋添付待ち後にテスト受信へ移動。Aが次のtickでTXT、Macが次のlaunchdでJSON＋ready、Aが次のtickでDoc/Notion/台帳を作成。時刻の組み合わせで概ね終了後20〜80分＋添付生成/モデル/同期時間がかかります。
3. 台帳に新しいMTG番号1件、会議フォルダ・Doc・Notionテストページ各1件、JSON/readyは_done、TXTは会議フォルダへ移動。さらに2周期待って増えないこと。Chatworkは未設定のまま予定ログだけ。
4. 除外試験：`【記録なし】`付き会議、非公開会議、添付を生成しない会議も作成し、テスト受信へ新規移動されないことを確認。
5. メモのみ試験：「会議を文字起こし」はオフ、Geminiメモはオン。既定は終了後120分以降にメモを採用（各周期分を加算）。待機時間を短縮して試すならA/B両方のMOVER_MEMO_WAIT_MIN=20にし、終了後に120へ戻す。新しいDoc/Notion・台帳に注意書き、確信度低・仕分け待ち。原文ありの会議と混同しないこと。
6. 停止試験：新しい会議のTXTが出た後、Macのlaunchdを一時停止。GENERATOR_TIMEOUT_MIN経過＋次tickで停止検知とChatwork予定ログが各1件出ること。同じ障害で次周期に重複しないこと。launchdを再開し、JSON/取り込みが自動で進み、停止検知解除が出ること。閾値を15へ一時短縮した場合は120へ戻す。
7. 連続失敗の試験が必要なら、launchdの`--codex`だけ一時的に存在しないパスへ変更（node/run.cjsのパスは正しく維持）。3周期でstatus失敗3件と通知予定が出ること。正しいパスへ戻した次の成功で解除されること。Codexログイン情報や業務ファイルは消さない。試験後は必ず正常設定へ戻す。

異常時はGASの実行履歴・台帳・Macログを確認。GOOGLE_CREATE_PENDING:*、NOTION_FIXTURE:*、_local_codexの完了記録はリセットしません。結果不明の作成は自動再送せず人が確認します。

## 5. 停止と本番切替までの残作業

停止はBの登録解除と、AのremoveAutomationTrigger（DRY_RUN=falseで実行）、Macのlaunchd停止。予定表示だけにするならA/Bをtrueへ変更。解除関数は自分の該当トリガーだけを変更します。ref/登録同期等の別トリガーは必要に応じて各解除関数を使います。

本番切替には少なくとも次が残ります。今回いずれも本番へ変更しません。

- 常時稼働PC・責任者・スリープ/更新/認証復旧手順、launchdとDrive同期の監視、status/ログ蓄積の保全・アーカイブ方針。
- 社員Workspaceメール・Notionユーザー・閲覧権限・確認者のマスタ整備。現在のBはfinance@だけ。社員主催への拡張・認証/権限/共有ドライブ移動を本人ごとに実機検証。
- 記録除外方針と周知、録画/文字起こし/メモの会議設定、会議データをCodexクラウドへ送る運用の社内承認。
- 本番のフォルダ/台帳/DBマッピング、本番Notionの確認状態追加を人が承認、コードのtest専用ID/ENVガードをレビューしたうえで本番対応。ENVだけ変えても本番運用はできません。
- Chatworkトークン・テストルームでPOST/PUT/返信の実機確認、監視の実通知・独立した稼働監視・障害時の担当者通知。
- tl;dv経路（段階4）、タスク提案の承認/反映（段階5）、朝一覧・運用監視・的中率集計など未完の段階を用途に応じて実装/検証。
- 今回の無人通し・メモのみ・除外・停止/回復試験の実機合格と、二重作成/公開範囲/復旧の確認。人の承認を得てから本番切替。

今回ローカル183件のテストとbuild/check/smokeを確認。GAS実行・設定変更・デプロイ・Mac更新・無人実機試験はユーザー側です。Calendarの[予定一覧](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)と[visibility](https://developers.google.com/workspace/calendar/api/v3/reference/events)はGoogle公式本文で確認しました。
