# finance@の共有ドライブで段階2を検証する

GAS・共有ドライブの作成管理と、ChatGPT（premiere・Plus）のGoogle Drive接続には **finance@premiere-mode.co.jp** を使います。Notionのオーナーと内部インテグレーションの作成者は **contact@** のままです。Notion管理用ページの表示名も変更しません。
finance@の本体GASとDrive構成はユーザーが作成済みです。この版の実GAS実行・実サービスへの書き込みはまだ行っていません。

## 1. finance@のGASに反映する

1. Apps Script右上のアカウントが `finance@premiere-mode.co.jp` であることを確認し、作成済みの「MTG議事録自動化・本体」を開きます。
2. workブランチの `dist/gas-core/Code.gs` をダウンロードし、コード.gsを全文置換して保存します。
3. `dist/gas-core/appsscript.json` も反映します。プロジェクト設定からマニフェスト表示を有効にすると編集できます。
4. 左の「サービス」にDrive API v3があることを確認し、なければ追加します。標準のGoogle Cloudプロジェクトを使う場合はそちらのDrive APIも有効にします。

Drive・スプレッドシート・ドキュメント・外部リクエストのスコープを使用します。権限画面はfinance@で内容を確認して許可してください。
Workspace管理者であることと、共有ドライブ内での編集・移動権限は別です。権限不足なら停止し、マイドライブへ自動で迂回しません。Webアプリ公開・時間トリガー・GAS-B実行はまだ不要です。

## 2. スクリプトプロパティ

finance@の新GASの「プロジェクトの設定」→「スクリプト プロパティ」に設定します。

| プロパティ | 値 |
|---|---|
| ENV | `test` |
| DRY_RUN | 最初は `true` |
| SHARED_DRIVE_ID | `0ALo4SlMVSpXdUk9PVA` |
| FOLDER_SYSTEM_ID | `1UbflVH7ITQBN6INYyAQyn7fy77CWl4wH` |
| FOLDER_SYSTEM_TEST_ID | `1pKWcGDuRCBf3VG0AfKBaKghE0nD3kYwW` |
| FOLDER_INBOX_RAW_ID | `1jNifZBBUN0QNMWdA_hI2J5YY2PbqtxoB`（本番用・今回不使用） |
| FOLDER_INBOX_RAW_TEST_ID | `1Hip4qiyC3sUsPhqCj8JGAFKj8zLaUHaC` |
| LEDGER_SPREADSHEET_ID | `1VrooNKgbSN5V579yk-m5Ag0j2atBcL_qFU1eQ5NSOTY`（テスト台帳） |
| NOTION_DB_MINUTES_TEST | `d9cc47f9-543e-4bcb-8ec8-27bebc0feac5` |
| NOTION_DB_TASKS_TEST | `c908936a-6999-4119-9e9c-df364f5f5d1b` |
| NOTION_DB_TLDV_INBOX | `400ca178-7419-80dd-a3e0-ef9e2267a64c` |
| NOTION_TOKEN | 人が「MTG議事録連携（GAS）」のトークンを入力。チャットやGitへ貼らない |
| NOTION_REQUESTER_TYPE | `people` |
| INGEST_BATCH | `5` |
| SETUP_CREATE_TEST_DB | `false` |
| CHATWORK_TOKEN | 未発行なので未設定 |

`TEST_ENV_KEY` は準備関数が_testの既存目印から採用するか、新規に生成・保存します。旧マイドライブのTEST_ENV_KEY・フォルダID・台帳IDをまとめてコピーしないでください。
本番台帳 `137IuSH4nGulMcsB5-IKqvIXkw8SiQrFBjFNSAeXNt0c` は使用しません。LEDGER_SPREADSHEET_IDにはテスト台帳だけを設定します。

### Notion重複防止記録の移行

スクリプトプロパティはGASプロジェクトごとに別です。staff.presuiのGASにある **`NOTION_FIXTURE:*` の3件** を、同じキー・同じJSON値でfinance@のGASへコピーします。値はstate=createdと既存NotionページIDを含む記録で、トークンとは別です。旧記録は削除しません。
pending記録がある場合は作成済みに書き換えず、実Notionで結果を確認してください。
記録がない新GASでは同じサンプルも新規作成対象になるため、先に移行してください。記録を移すと既存3ページを所属確認して再利用します。

## 3. 既存構成を読み取り確認

**DRY_RUN=true** で **`setupSharedTestWorkspace`** を実行します。GASの関数選択からそのまま実行でき、上記のプロパティを使います。
コードからは `setupSharedTestWorkspace(sharedDriveId, testRootId, testLedgerId)` の3引数でも呼べます。

確認項目：

- `_system` が指定共有ドライブ直下にあり、`_test` がその直下にあること
- テスト台帳が同じ共有ドライブの_test配下にある編集可能なスプレッドシートであること
- 既存台帳の見出しがSPECと一致し、既存マスタのフォルダIDが_test内にあること
- FOLDER_INBOX_RAW_TEST_IDが_test直下の00_受信であること
- 目印が既存設定と衝突せず、必須フォルダに同名重複・同名の非フォルダがないこと

不足フォルダと台帳初期化予定をログに出します。Drive・台帳・設定には書き込みません。
報告済みの構成どおりなら、主な不足は `99_対象外/_空` と `社外/サンプル商事様` です。
名前はSPECの `_system`・`_test`・`00_仕分け待ち`・`99_対象外`・`_done` を使い、別名を自動改名しません。

**テスト台帳が_test外にある場合は停止します。** 自動移動・その場での初期化は行いません。配置を確認し、_test配下のテスト台帳IDを指定してください。

## 4. テスト領域だけ準備する

**DRY_RUN=false** に変更し、**`setupSharedTestWorkspace`** を再実行します。

- 目印は_testだけに付けます。_systemは本番側でもあるため読み取りだけで、appPropertiesも変更しません。
- _testの既存appPropertiesは保持し、minutes_test_envとkind=test_rootを追加します。
- 既存フォルダを再利用し、不足する規定フォルダ・サンプル顧客フォルダだけを_test内に作ります。
- テスト台帳にSPECの10シートと見出しを作り、サンプルの部署・顧客・社員マスタを不足分だけ投入します。既存データは上書きせず、初期シートも削除しません。
- TEST_ENV_KEYなどをこのGASのプロパティへ保存します。
- フォルダの移動・改名・削除、本番台帳・本番フォルダへの書き込みは行いません。

再実行で同じフォルダ・マスタを増やさない構成です。旧マイドライブ版のsetupTestWorkspaceは今回は使いません。

## 5. サンプル投入・取り込み

| 順番 | DRY_RUN | 関数 | 期待結果 |
|---|---|---|---|
| 1 | false | `seedFixtureInbox` | _test内に判定JSON・manifest・議事録Doc・ダミー文字起こしを3件準備 |
| 2 | true | `checkTestEnvironment` | Notionの項目名・型・差分を読み取り確認 |
| 3 | true | `ingestInbox` | 確認待ち／確認待ち／仕分け待ちと送信予定を表示、dry_run_logへ記録 |
| 4 | false | `ingestInbox` | テスト台帳3行・会議フォルダ3件、ファイル移動・JSONの_done移動 |
| 5 | true | 設定を戻す | 通常の予定確認モードへ戻る |

移行したNOTION_FIXTURE記録があれば「作成済み（再利用）」となりNotionページを増やしません。記録がない新しいmeeting_keyだけ新規作成対象です。
Chatwork未設定時は投稿せず、予定を実行ログとテスト台帳のdry_run_logへ残します。タスク提案はログだけです。実録画MP4は使わずダミー文字起こしで検証します。

tl;dv受信DBの選択肢が不足している場合だけ、addTldvInboxStatusOptionsをtrueで予定確認→falseで追加の順に実行します。Notionは従来と同じDB・contact@の内部インテグレーションを使います。
保留・エラー再開は `docs/INGEST_INBOX_TEST.md` の「失敗時と再開」を参照します。NOTION_PAGE・NOTION_FIXTUREのpending記録は確認なしに消しません。

## 検証範囲

Drive一覧はcorpora=drive・指定driveId・includeItemsFromAllDrivesを使い、取得・作成・更新・移動でsupportsAllDrives=trueを指定します。
ローカルの共有ドライブ模擬環境で、実Driveアダプタ・台帳・seedFixtureInbox・ingestInboxを組み合わせて準備・DRY_RUN・取り込み・再実行をテストしています。
_test外への更新を禁止するテストダブルで、_system・本番台帳・本番受信フォルダを変更しないことも確認しています。実finance@の権限と共有ドライブ動作はユーザー側で確認します。
