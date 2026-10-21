# スクリプト プロパティ一覧（値はここに書かない）

GAS エディタ「プロジェクトの設定」＞「スクリプト プロパティ」に登録する。秘密値（★）は Git に入れない。

## GAS-A（本体）

| キー | 例・既定 | 説明 |
|---|---|---|
| DRY_RUN | `true` | 開発中は true。本番切り替えは人の承認後 |
| SETUP_CREATE_TEST_DB | `false`（初期作成時のみ `true`） | `ENV=test` と組み合わせ、setupTestDatabasesによる管理ページ下のテストDB作成だけを許可。実行後falseに戻す |
| ENV | `test` / `prod` | test のとき下の *_TEST を使う |
| LEDGER_SPREADSHEET_ID | | 台帳スプレッドシート |
| SHARED_DRIVE_ID | | 共有ドライブ「MTG記録」 |
| FOLDER_SYSTEM_ID / FOLDER_SYSTEM_TEST_ID | | `_system` / `_system/_test` |
| NOTION_TOKEN ★ | | 内部インテグレーションのトークン（contact@ が作成） |
| NOTION_VERSION | 公式で確認 | Notion API のバージョン |
| NOTION_DB_MINUTES / NOTION_DB_MINUTES_TEST | 本番 `4cf02dee-7a11-4319-ace1-e866d6a1a914` | MTG議事録 |
| NOTION_DB_TASKS / NOTION_DB_TASKS_TEST | 本番 `e321f1cb-3365-4a2c-9844-47f34734a9d7` | プロジェクト・タスク |
| NOTION_DB_NONPROJECT | （要決定） | TASK_DB_MODE=dual のとき |
| NOTION_DB_TLDV_INBOX | | tl;dv 受信 |
| NOTION_MTG_URL_SOURCE | `none` | `folder` / `meet` / `none`（要決定） |
| TASK_DB_MODE | `single` | `single` / `dual`（要決定） |
| CHATWORK_TOKEN ★ | | 投稿アカウントの API トークン |
| CHATWORK_ROOM_ID / CHATWORK_ROOM_ID_TEST | | 議事録確認ルーム／テスト用ルーム |
| CHATWORK_ADMIN_ACCOUNT_IDS | | 停止・エラー時にメンションする人（カンマ区切り） |
| WEBAPP_URL | | 確認画面のURL。GAS所有者を個人Gmailに変更したため公開方式は未確定。今は空欄 |
| GENERATOR_MODE | `CHATGPT` | `CHATGPT` / `OPENAI_API` |
| OPENAI_API_KEY ★ | | OPENAI_API のときだけ |
| OPENAI_MODEL | | OPENAI_API のときだけ |
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
| CORE_WEBAPP_URL | | 登録情報を GAS-A に送る場合の送り先（要確認） |
