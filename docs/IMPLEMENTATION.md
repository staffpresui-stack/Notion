# 実装状況

## 最新のユーザー側実機結果と段階2

`42a5326` の接続確認とサンプル3件の実作成がユーザー側で成功しました。判定・本文・領域・日付をNotion上で確認済み、DRY_RUNはtrueへ復帰済みです。
tl;dv受信DBは `400ca178-7419-80dd-a3e0-ef9e2267a64c`。差分は選択肢追加関数、既知の追加項目3件の許容、依頼者people仮既定で対応します。
マイドライブ用 `setupTestWorkspace`、`seedFixtureInbox`、`ingestInbox`、`retryInboxErrors` を追加しました。`docs/INGEST_INBOX_TEST.md` に実行手順を記載しています。
Notion保留時の継続・再開、移動後の再開、本文の100ブロック分割、重複防止、Chatworkトークン無しの予定ログをローカルで検証しています。
今回追加したGAS関数はユーザー側でまだ実行していません。共有ドライブ・実録画MP4の移動・Chatwork実投稿も実機未検証です。

## 接続確認・段階2のNotionサンプル部分

ユーザー報告でテストDBの初期作成成功・ID設定・フラグ解除・トークン差し替えを確認済みです。
`checkTestEnvironment()` と `ingestFixturesToNotionTest()` を追加しました。手順と固定テストIDは `docs/NOTION_FIXTURE_TEST.md` にまとめています。
Drive・Chatworkを使わず、既存の判定サンプル3件を処理します。純粋な判定とHTTPスタブで検証しています。GAS実行・実Notionへの作成はユーザーが行います。
段階2全体（実Drive配置・台帳への取り込み・Chatwork通知）が完了したという意味ではありません。

## テストDB初期化の追加

`setupTestDatabases()` を追加しました。専用フラグでユーザーが実行し、本番スキーマを読み取り、管理ページ下にテストDBを作成できます。
詳細は `docs/SETUP_TEST_DATABASES.md` を参照してください。純粋関数とHTTPスタブによるローカル検証を追加しています。GAS実行・実Notionへの書き込みは行っていません。
元のポータルIDはテストDBではなく、ユーザー確認時点でテストDBは存在しません。

## これまでの作業

- 提供ZIPの仕様書・指示書・スキーマ・サンプルを取り込みました。
- ユーザー確認：tl;dvは無料プランです。文字起こしを対象とし、tl;dvのMP4取得・保存は実装しません。Meetの録画は仕様どおり対象です。
- 段階0の設定検査、Notionスキーマ読み取り、共有ドライブのテストルート検査、台帳とフォルダ登録の計画を実装しました。
- GAS-AとGAS-BのV8マニフェストを用意しました。GAS-Bの会議移動処理・Web画面・トリガーは未実装です。
- 次段階に備え、API非依存の重複照合・顧客判定・配置計画を実装しました。tl;dvの待機時間・Meet優先・MP4なしをサンプルで確認しています。外部への取り込み・移動はまだ実装していません。
- `checkNotionConfig()` によりNotionだけを先に検証できます。全体設定の不足は `checkConfig()` で確認します。
- `npm run build` で各GASプロジェクトに一括で貼れる `Code.gs` を生成できます。
- ローカルテスト19件とサンプル5ケースが成功しました。サンプル検証には明示した検証用manifestも使い、実データの動作確認とは区別しています。

## 接続の確認結果

現在利用できるツールには、ユーザーのブラウザーを操作する接続がありません。
Google用環境変数の参照先は空のJSONで、claspのログイン情報もありませんでした（秘密値は表示していません）。
Apps ScriptとGoogleログイン画面へのHTTPS接続はプロキシから403でした。公式Googleドキュメントへのアクセスは現在200です。
接続用ドメイン追加は環境設定の下書きに保存します。保存はログインやOAuth許可の代わりにはなりません。

## 安全な初期動作

開発中は `ENV=test`、`DRY_RUN=true` だけを受け付けます。本番への切替機能はまだありません。
`initLedger()` と `registerFolders()` は計画を `dry_run_log` に記録するだけです。
仕様書の「段階0：書き込みなし」と「台帳・マスタの初期作成」の間に食い違いがあるため、現段階では業務シートの作成・マスタ登録は適用しません。
初期化計画を取得するには、テスト専用の台帳スプレッドシートを先に用意してください。
`dry_run_log` がなければ、そのシートと見出しだけを作成します（仕様で許可された記録先）。

台帳IDにはテスト用を設定してください。GASの実行主体はstaff.presui@gmail.comです。
`NOTION_DB_TLDV_INBOX` も開発中はテスト用DBを指定してください。
2DB構成のときは追加の `NOTION_DB_NONPROJECT_TEST` が必須です。
GAS-Bにも `DRY_RUN=true` を設定します。

## 実機で未確認の項目

- staff.presui@gmail.comでのApps Script認証・プロジェクト作成と権限許可
- スクリプトプロパティの設定とNotionスキーマ取得
- 台帳の実初期化、マスタ登録、Meetのファイル移動
- ChatGPT予約タスクによるDriveへの無人書き込み
- Notion・Chatworkへのテスト書き込みと本番切替

ChatGPT Plus契約だけではOpenAI APIの利用料金・APIキーは付属しません。
生成モードの最終決定は、予約タスクの実機確認後に行います。

## 公式仕様の確認元

公式ドキュメントサイトへのアクセスは現在のネットワーク制限で403でした。
段階0で使うAPIは以下の公式リポジトリを取得して確認しました。

- Notion公式SDK `makenotion/notion-sdk-js`：`src/Client.ts`、`src/api-endpoints/databases.ts`、`src/api-endpoints/data-sources.ts`。SDK既定版 `2025-09-03` を採用しました（最新版であるとの断定はしません）。
- Google公式サンプル `googleworkspace/apps-script-samples`：`advanced/drive.gs`、`advanced/calendar.gs`
- Google公式Discovery `googleapis/google-api-go-client`：`drive/v3/drive-api.json`

Chatwork・OpenAIの送信処理は未実装です。実装前に公式仕様を確認します。
