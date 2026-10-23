最新の既定はGEMINI_NOTES。本番の全設定値は[本番切替ガイド](../docs/GEMINI_NOTES_PRODUCTION.md)を参照。LOCAL_CODEXは恒久実行しません。

# スクリプト プロパティ一覧（値はここに書かない）

GAS エディタ「プロジェクトの設定」＞「スクリプト プロパティ」に登録する。秘密値（★）は Git に入れない。

## GAS-A（本体）

| キー | 例・既定 | 説明 |
|---|---|---|
| DRY_RUN | `true` | 読み取り・予定表示はtrue。ユーザー実行のテスト環境準備・選択肢追加・ingestInbox検証時だけfalse。本番切り替えとは別 |
| SETUP_CREATE_TEST_DB | `false`（初期作成時のみ `true`） | `ENV=test` と組み合わせ、setupTestDatabasesによる管理ページ下のテストDB作成だけを許可。実行後falseに戻す |
| ENV | `test` / `prod` | test のとき下の *_TEST を使う |
| LEDGER_SPREADSHEET_ID | | 台帳スプレッドシート |
| SHARED_DRIVE_ID | | 共有ドライブ「MTG記録」。現在はfinance@の共有ドライブIDを設定。未設定可なのは旧ENV=test代用モードのみ |
| TEST_ENV_KEY | 自動生成 | 共有ドライブはsetupSharedTestWorkspaceが_testの目印に採用・生成する識別子。_systemには付けない。変更・削除しない |
| FOLDER_SYSTEM_ID / FOLDER_SYSTEM_TEST_ID | | `_system` / `_system/_test` |
| NOTION_TOKEN ★ | | 内部インテグレーションのトークン（contact@ が作成） |
| NOTION_VERSION | 公式で確認 | Notion API のバージョン |
| NOTION_DB_MINUTES / NOTION_DB_MINUTES_TEST | 本番 `4cf02dee-7a11-4319-ace1-e866d6a1a914` | MTG議事録 |
| NOTION_DB_TASKS / NOTION_DB_TASKS_TEST | 本番 `e321f1cb-3365-4a2c-9844-47f34734a9d7` | プロジェクト・タスク |
| NOTION_DB_NONPROJECT | （要決定） | TASK_DB_MODE=dual のとき |
| NOTION_DB_TLDV_INBOX | | tl;dv 受信 |
| NOTION_MTG_URL_SOURCE | `none` | `folder` / `meet` / `none`（要決定） |
| TASK_DB_MODE | `single` | `single` / `dual`（要決定） |
| NOTION_REQUESTER_TYPE | `people` | 依頼者の型の仮既定。people／rich_text／emailで切替可。接続確認に反映し、タスク書き込みはまだ行わない |
| CHATWORK_TOKEN ★ | | 未設定なら投稿せず実行ログとdry_run_logに予定を表示。今回の検証では空欄のまま |
| CHATWORK_ROOM_ID / CHATWORK_ROOM_ID_TEST | | 議事録確認ルーム／テスト用ルーム |
| CHATWORK_ADMIN_ACCOUNT_IDS | | 停止・エラー時にメンションする人（カンマ区切り） |
| WEBAPP_URL | | 確認画面のURL。GAS所有者はfinance@のWorkspaceアカウント。ドメイン限定の公開方式・操作者識別は未検証。今は空欄 |
| GENERATOR_MODE | `GEMINI_NOTES` | PC不要。旧LOCAL_CODEX/CHATGPTはtest互換だけ。OPENAI_APIは拒否 |
| FREE_MAIL_DOMAINS | `gmail.com,yahoo.co.jp,outlook.jp,outlook.com,icloud.com,hotmail.com` | 顧客判定に使わないドメイン |
| INGEST_BATCH | `5` | 1回の取り込み件数 |
| TLDV_WAIT_MIN | `60` | tl;dv 照合までの待ち時間 |
| MATCH_WINDOW_MIN | `15` | Meet 照合の時刻の幅 |
| GENERATOR_TIMEOUT_MIN | `180` | 判定が来ないときに通知するまでの時間 |
| TLDV_REMAINING_ALERT | `5` | tl;dv の残り回数の通知しきい値 |
| DIGEST_HOUR | `9` | 朝の一覧の時刻 |

## GAS-B（主催者用）

| キー | 例・既定 | 説明 |
|---|---|---|
| SHARED_DRIVE_ID | | 共有ドライブ「MTG記録」 |
| FOLDER_INBOX_RAW_ID / FOLDER_INBOX_RAW_TEST_ID | | `_system/00_受信` / `_system/_test/00_受信` |
| ENV | `test` / `prod` | |
| MOVER_INTERVAL_MIN | `15` | |
| MOVER_WAIT_MIN | `20` | 会議終了から移動を始めるまでの時間 |
| MOVER_TEST_EVENT_ID | | GAS-B実機テスト対象のCalendar API予定ID。指定した1件のみ処理 |
| FOLDER_SYSTEM_ID / FOLDER_SYSTEM_TEST_ID | | 指定共有ドライブの_systemと_test。GAS-Bで実階層を検証 |
| DRY_RUN | true | falseは本人が登録しテスト移動を実行するときだけ。AとBで別設定 |

## 段階3の確認画面

- REVIEW_MASTER_ACCESS：既定false。finance@だけ。trueにするとmasters_peopleの登録・役割・担当・領域・ランクを照合して社員を許可します。初回デプロイはMYSELFです。
- REVIEW_TEST_FAIL_STEP：テスト用の一度だけの停止位置。通常は削除。after_drive／after_notion／after_chatwork。ENV=testかつfinance@の操作時だけ有効です。
- WEBAPP_URL：finance@でデプロイした /exec URL。Chatwork予定本文の確認リンクに使います。

マスタ・HTMLファイル・デプロイ・試験順は docs/REVIEW_TEST.md を参照してください。

段階3の修正版は新しいプロパティを追加しません。setupReviewNotionStatusでテストDBの確認状態と既存ページを準備します。更新・計測の手順は docs/REVIEW_UPDATE.md を参照してください。

GAS-Bの具体値・作成手順は docs/ORGANIZER_TEST.md。今回はfinance@だけをコードで許可します。登録情報は_test/_organizersからGAS-Aへ同期するため、CORE_WEBAPP_URL・台帳ID・NotionトークンはGAS-Bに不要です。

## PCのCodex生成

追加の秘密プロパティは不要です。手順は `docs/LOCAL_CODEX_TEST.md`。exportTranscriptTextsと任意のsetupTranscriptExportTriggerをGAS-Aで実行します。FOLDER_INBOX_RAW_TEST_IDは既存値を維持。GAS-AにDocs v1サービスを追加しますがOAuthスコープ追加はありません。

## テストの無人運転（最新）

手順は `docs/AUTOMATION_TEST.md`。GAS実行・設定はユーザーが行います。初期確認後はA/BともENV=test・DRY_RUN=falseを維持し、会議ごとの手動実行を不要にします。

| 対象 | キー | 既定/値 |
|---|---|---|
| B | MOVER_MODE | TEST_EVENT（互換）／AUTO（今回設定）。AUTOではMOVER_TEST_EVENT_ID不要 |
| A/B | MOVER_MEMO_WAIT_MIN | 120。20〜2880分。文字起こしがなくGeminiメモがある場合の待機 |
| A | GENERATOR_TIMEOUT_MIN | 120。15〜1440分。TXT出力後にJSON/取り込みが完了しない閾値 |
| A | LOCAL_FAILURE_ALERT_COUNT | 3。1〜20回。直近4時間のMac連続失敗 |

AUTOMATION_ALERT:*は監視の通知重複防止・回復状態を自動保存。手動作成・リセットしません。setupAutomationTriggerは旧TXT単独トリガーだけ解除して統合トリガーへ移行します。

## GEMINI_NOTES本番・tl;dv監視

ENV=prod時はFOLDER_INBOX_RAW_ID、NOTION_DB_MINUTES、NOTION_DB_TASKS、PRODUCTION_START_AT、CHATWORK_TOKENが必要。CHATWORK_ROOM_IDは451196858固定。TLDV_CALENDAR_IDSでfinance@へ読取共有した業務カレンダーを設定、TLDV_RECEIVE_TIMEOUT_MINは120（15〜1440分）。無料枠の残数はsettingsのtldv_quota:<アカウントメール>にremaining/checked_atのJSONで登録。APIから自動取得した残数ではありません。CLASSIFICATION_RULES_JSONは部署/会議名キーワードの配列、未指定は6部署の正式名。
