# 即時Meetと記録起点の短間隔取り込み

## 今回の変更

f3966b0はBのコードだけ反映済みで、委任②は2段階認証の準備待ち・未実機です。**今回はGoogle Cloud・サービスアカウント・委任・Meet APIの有効化を必要としません。A/Bとも既存の通常版マニフェスト、Drive v3／Calendar v3／Docs v1で動かします。** 外部AI APIやPCは使いません。

起点は本人のDriveに作られたMeet記録です。初回だけ直近72時間の記録候補を読み戻し、その後はDrive Changes APIの差分と生成待ちの候補だけを確認します。本人所有・マイドライブの「Google Meet」または「Meet Recordings」の下にある、`Meetコード - 日時 JST`／`会議名 - 日時 JST` の会議別フォルダを対象にします。所有者・フォルダ・実MIMEを確認し、一般のDrive文書や共有ドライブの変更を会議として取り込みません。

- 予定あり：添付IDを優先し、Meetコード・時刻／会議名で予定と照合。従来のevent IDと予定開始時刻から作るキー・タイトル・参加者を維持。非公開／【記録なし】／他人主催／キャンセルは除外。複数候補やCalendar取得エラーを「予定なし」と扱いません。
- 予定なし：フォルダのJST日時、メモのタイトル・明示された参加者を使用。キーは `meet:instant_<コード>_<開始日時>`。参加者を推測で補わず、未確認として本文に残します。
- Gemini本文と文字起こし本文がある場合：内容が60秒以上変わらないことを2回以上の確認で検証して受け渡し。終了予定＋20分は待ちません。
- メモのみ：本文が180秒以上安定したらnotes_onlyとして進め、「文字起こしなし・メモから作成」。録画を待ちません。本文生成中の表示は待機。
- 記録が無い会議は対象外。録画しか無い場合は要確認のログだけで、空の議事録を作りません。
- 後着した録画等は同じ会議キーの追加受信manifestを作り、Aが既存の会議フォルダへ追加します。元manifestと台帳のファイル一覧も更新。Doc・Notion・Chatworkは二重に作成・投稿しません。同種の別ファイルが既にある場合は上書きせず要確認。

**Driveから実際の終了時刻・出席者全員・厳密な生成完了状態は取得できません。** 本実装は本文の準備・安定を確認する方式です。予定終了やDrive更新日時を実際の終了と偽らず、manifestのendは空、end_unknown=true、本文にも要確認を表示します。長い会議中に完成に見える文書が生成・停止した場合まで完全に判別できるとは保証しません。実際の終了の確定が必須になったら、Meet APIのendTimeによる裏取りと追加のOAuth承認・API有効化が必要です。今回はCloudの設定ブロックを避け、動く記録経路を優先しています。

## 反映するファイル

finance@で作業します。**A/B両方のCode.gsを更新**します。

1. GAS-A「本体」：`dist/gas-core/Code.gs` 全文を貼り替え。既存dev.gs、通常版appsscript.json、15分のautomationTick_、本番設定は維持。
2. GAS-B「主催者用」：`dist/gas-organizer/Code.gs` 全文を貼り替え。**通常版appsscript.jsonのまま**。Register.htmlは変更なし。追加スコープ・再認証は不要。
3. Bの社員用登録画面も更新する場合は、既存Webアプリを新バージョンに更新（本人実行／DOMAINは維持）。新しい社員は従来の一度の登録で通常タイマーと記録差分の1分タイマーが各1個作られます。既存finance@は登録し直さず下記setup関数で追加できます。
4. AのWebアプリの再デプロイは不要です。時間トリガーは保存した最新コードを使用します。

## 最初の1件：10/23 17:24、szo-aepv-eqp

既存の本番値を維持：ENV=prod、DRY_RUN=false、GENERATOR_MODE=GEMINI_NOTES（A）、PRODUCTION_START_AT=`2026-10-23T14:30:00+09:00`、本番Notion・共有Drive・台帳・Chatwork451196858は変更しません。SA_KEY_JSONやDWD_ENABLEDは設定・有効化しません。

Bへ追加します。

| プロパティ | 最初の値 | 説明 |
|---|---|---|
| MOVER_DISCOVERY_MODE | RECORDS | 記録起点。CALENDARへ戻せば従来の方式 |
| MOVER_SHARED_REGISTRY | true | 各自登録と将来の委任で同じ処理済み記録を使う |
| MOVER_MODE | AUTO | 現在の値を維持 |
| RECORD_TEST_ONLY | true | 定期実行も含め、最初の1件だけに限定 |
| RECORD_TEST_MEET_CODE | szo-aepv-eqp | 最初の実機対象 |

`MOVER_WAIT_MIN=20`・`MOVER_MEMO_WAIT_MIN=20`は従来経路のため残して構いません。RECORDSでは予定終了からの固定待ちには使用せず、本文の安定状態で判断します。

実行順：

1. **B：`previewMeetRecords()`**。DRY_RUN=falseを変更せず読み取りだけで候補を表示。17:24のフォルダ・メモが検出され「移動候補（実運転で本文の安定を確認）」になること。差分位置・安定時刻・Drive・処理済み記録は書きません。
2. **A：`previewFastNotes()` → `setupFastNotesTrigger()`**。前者は短間隔受信の予定確認のみ。後者は現在のDRY_RUN=falseで1分のfastNotesTick_を1個追加。通常の15分tickは残ります。
3. **B：`runSingleMeetRecord()`**。初回は本文の安定確認待ち。移動前に内容ハッシュと確認時刻を保存します。**60秒後（メモのみなら180秒後）に同じ関数を再実行**し、readyになることを確認。別の会議は移動しません。あるいは次のsetupで定期実行に任せて待てます。
4. **B：`setupRecordMoverTrigger()`**。登録済みの本人に1分のrecordMoverTick_を1個追加。既存のmoverRunトリガーは残します。重複実行しても1個。
5. Aが次の1分チェックで拾い、会議フォルダ・Doc・Notionページ・Chatwork通知を1件ずつ作ることを確認。終了時刻／参加者の未確認は本文の要確認に出ます。
6. Bの同じ関数を再実行しても議事録が増えないこと。後から動画ができたら「後着ファイルを受け渡しました」→Aが同じ会議フォルダへ追加すること。
7. 合格後、**BのRECORD_TEST_ONLY=false**へ。RECORD_TEST_MEET_CODEは残しても、通常走査を制限しません。ここから本人の直近72時間の他のMeet記録も対象になります。

過去72時間を超えた記録・cutoff以前はこの読み戻しの対象外です。今回17:24の会議は72時間内に反映・実行してください。メモ内の文字起こしが無い場合は3分の安定確認後にメモだけで作成します。何も書かれていないメモを完成として取り込みません。

## 無人通しの確認

1. 関数を手で実行せず、finance@で新しい「今すぐ開始」のMeetを作成。Geminiメモと「会議を文字起こし」をオン。実音声で数分会話し、終了します。
2. メモ生成直後から、Bの実行履歴で「本文の安定確認待ち」→ready、Aで作成済みを確認。予定なしでも1件のみ。
3. カレンダー予定からのMeetでも同じ試験。予定のタイトル・参加者と旧形式のmeeting_keyを使用し、元のカレンダー添付リンクが開けること。
4. メモだけ、録画だけ、非公開、【記録なし】、他人主催、cutoff以前も確認。録画だけではDocを作らないこと。
5. 後着録画の追加では元のDoc／Notion本文・Chatwork通知数が変わらないこと。

目安は **Gemini本文＋文字起こし本文が揃ってから通常2〜4分**（Bで発見・60秒の安定確認、Aで次の1分確認、実作成のAPI時間）。**メモのみは4〜6分**。Google側の生成時間、GASタイマーの遅延、初回読み戻し・候補の混雑、Notionの制限分は別途かかります。終了後の固定20分＋15分＋15分は通常経路では不要です。実機の時間は未計測なのでSLAではありません。

## 上限の試算と運用

1分はApps Scriptの時間主導トリガーで選べる最短です。通常の待機時、Bはchanges.listだけ、Aもchanges.listだけ。台帳・全案件861件・Notionスキーマは新しい受信がある時だけ読みます。Aの従来15分tickはtl;dv・停止監視・途中処理の再開を継続します。

| 項目 | 今回の概算（finance@、1日20会議の例） |
|---|---|
| アイドル差分確認 | A/B各1,440回/日、計2,880リスト呼び出し。生成待ち中・初回・仕事のある時は追加 |
| Driveレート | アイドル各プロジェクトで約100 quota units/分。新方式の公式上限1,000,000/プロジェクト/分・325,000/ユーザー/プロジェクト/分に比べ十分小さい。GETは5、リストは100、更新は50が目安。既存プロジェクトは旧上限が適用されることもあるためConsoleの実枠を優先 |
| Drive日次 | アイドル各144,000 units/日。新方式の公式日次閾値400,000,000 units/プロジェクトに対して小さい。録画をダウンロード・アップロードし直さず同じIDで親を変更 |
| UrlFetch | Bの通常記録経路は0。Aは議事録作成・通常15分のNotion問い合わせ・Chatwork。20会議×概ね20〜50回＋通常tick分を見ても数千回/日程度の想定で、Workspaceの100,000/日より小さい。本文量・再試行で変動 |
| トリガー実行時間 | アイドルA/B各1秒なら計48分/日。各2秒なら計96分/日。例として作成20件×30秒で10分、既存15分tick96回×30秒で48分を足すと約106〜154分/日。Workspaceの全プロジェクト合計6時間/ユーザー/日より小さい想定。実値は実機で確認 |

**実行時間はAPIの応答速度に依存するため、未計測のまま必ず上限内と保証しません。** A/Bの短間隔側は各90分/日（JST）の実測予算で抑え、到達後はその日の短間隔処理を控えて通常の15分経路を続けます。翌日再開。起動・設定読み取りや他プロジェクト分はこの計測に含まれないため、GASダッシュボードの実測合計も確認します。Aでエラーが続く時は重い再試行を5分待ちにします。

`checkRecordMoverStatus()`（B）・`checkFastNotesStatus()`（A）でpendingとmetricsのms/runsを確認。アイドル20回程度の実測で平均が3.75秒を大きく超える場合、1日1,440回では90分の予算を使い切ります。その場合は短間隔トリガーを解除し、GASのトリガー画面から同じハンドラーを5分で1個設定する代替が可能（通常15分は維持）。5分では1日288回で実行回数を80%削減できますが、目安はメモ＋文字起こしで6〜12分程度へ延びます。1分が無理な実測の場合に速度を偽って報告しないでください。

Drive/APIの429/一時障害の再試行は既存ラッパーを利用。差分位置より先に候補・受信キューを保存し、処理が失敗しても失いません。1回3会議まで、生成待ちの候補は順番を回すので同じ古い候補だけを処理し続けません。

## ①と将来の②、切り戻し

- 同じRecordDiscovery_へ、①は通常OAuthのDrive/Docs/Calendar、②は各本人へ委任したアダプターを渡します。キー・準備判定・移動処理は共通。同じBのScriptLockと共有処理済み記録を使います。
- ②は今回は保留のまま。追加のMeet APIスコープやAPI有効化はありません。将来②を設定する際は[委任手順](DOMAIN_DELEGATION.md)を参照。現状の管理者トリガーは15分・分割実行で、全社員分を1分で回せると未検証のまま断定しません。
- 旧UserPropertiesの処理済みも読み、予定ありの旧キーを維持。既存Notion・台帳・処理済み記録をリセットしません。
- `removeRecordMoverTrigger()`（B）と`removeFastNotesTrigger()`（A）は短間隔だけ停止。通常15分・本番データは維持。BをCALENDARへ戻す場合もMOVER_SHARED_REGISTRY=trueと既存記録を残します。即時MeetはCALENDARでは拾えなくなります。
- 本文生成後の元メモ編集を自動で議事録へ再反映する変更ではありません。初回の本文を保持し、後着成果物の追加だけ行います。

## 公式仕様

- [Apps Script上限（Workspaceトリガー6時間/日・UrlFetch100,000/日）](https://developers.google.com/apps-script/guides/services/quotas)
- [時間トリガー everyMinutes（1/5/10/15/30）](https://developers.google.com/apps-script/reference/script/clock-trigger-builder#everyMinutes(Integer))
- [Drive差分](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [Drive API上限（2026年5月から新方式、既存枠はConsole優先）](https://developers.google.com/workspace/drive/api/guides/limits)
- [Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Meet conferenceRecords.list（将来の厳密な終了判定の選択肢）](https://developers.google.com/workspace/meet/api/reference/rest/v2/conferenceRecords/list)

## e7c7944反映後の差分API修正

ユーザー実機で、Apps Script拡張サービスの `Drive.Changes.list` に必要なpageToken位置引数の不足が判明。A/Bとも `Drive.Changes.list(pageToken, optionalArgs)` に修正し、optionalArgsからpageTokenを取り除きます。`getStartPageToken(optionalArgs)` は元の形で正しいため維持。Files.list/get/create/update/generateIds、Calendar.Events.list/get、Docs.Documents.getも公式DiscoveryのparameterOrderとApps Scriptのbody→必須引数→media→optional規則を点検しました。

再反映はA/Bのdist/Code.gsだけ。スクリプトプロパティ・差分token・安定確認・処理済み記録・通常版manifest・既存トリガーを変更/リセットしません。GASへ直接入れた暫定修正と同じ動作です。初回だけでなく、差分確認の2回目以降が連続して成功することを実行履歴で確認します。拡張サービス用モックは今回の単一オブジェクト誤形式を拒否するように変更しました。委任のREST APIはHTTP queryにpageTokenを含める方式が正しく、変更しません。

照合元：[Apps Script拡張サービスの引数規則](https://developers.google.com/apps-script/guides/services/advanced)、[Drive v3 Discovery](https://www.googleapis.com/discovery/v1/apis/drive/v3/rest)、[Calendar v3 Discovery](https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest)、[Docs v1 Discovery](https://www.googleapis.com/discovery/v1/apis/docs/v1/rest)。
