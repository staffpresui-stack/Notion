# ローカルCodex生成への変更（最新）

d4a570eの参照出力・MarkdownのDoc表示・04のNotion取り込みはユーザー実機合格。クラウドのアップロードは安全チェックで失敗。今回OPENAI_APIは不採用とし、GAS-Aに原文TXTの新規書出しと任意15分トリガー、PCにread-onlyのCodex生成とJSON検証・非上書き保存・同期完了印、launchd/cron例を追加。GASは完了印のハッシュが一致するまで待ちます。GASのDocs読取・既存TXTの非上書き・manifest追記・範囲外拒否、ローカルの重複防止・原文変更・スキーマ・同期完了と既存ingestをモックで検証。PC実機、GAS実行、Plus認証、Drive同期、launchdは未実施。手順はLOCAL_CODEX_TEST.md。CLIは同梱0.163.0ヘルプ、Plusログイン対応はOpenAI公式GitHub README、Docsタブ仕様は公式本文で確認。開発者サイト本文はこのネットワークから取得できませんでした。153件のテストとbuild/check/smokeが成功。

# 予約タスクのJSON単独出力への対応（最新）

通常チャットで文字起こしタブの原文取得と共有ドライブへのJSONアップロードはユーザー実機合格。親指定のネイティブDoc作成はOAuth接続でINVALID_ARGUMENTとなるため、ChatGPTはminutes_markdown全文入りJSONだけをアップロードし、GAS-AがDocを作る形に指示文・SPEC・スキーマ説明を変更しました。Markdownの見出し・箇条書き・番号付き・表からDoc用HTMLとNotion要素を生成する処理を追加。参照ファイル不在はテスト中だけ空扱いで続行し、要確認へ記録します。無人タスクのアップロード許可の持続は未確認です。参照書き出しと合わせてローカル141件のテストが成功。実GAS・予約タスク実行・実Doc表示の確認は行っていません。

# 段階1実機合格と参照ファイル出力（最新）

4df9ba3を反映したfinance@の実機で、Gemini内文字起こしタブを含む2ファイルのテスト受信への移動・manifest ready・IDと元リンクの維持・元サブフォルダを残す動作・再実行での二重移動防止・B登録解除・A同期が合格。A/BともDRY_RUN=trueへ復帰済みです。ChatGPTはpremiere・PlusにGoogle Driveコネクタ=finance@を接続する構成です。

GAS-AにexportRefと毎朝6時台の任意トリガー管理を追加します。台帳マスタとテストNotionを読み取り、test/refの同名JSONをID維持で更新。DRY_RUNは件数・予定ログだけです。syncOrganizerRegistrationsの実更新ログを「同期しました」に分けました。手順はREF_EXPORT_TEST.md。実GAS実行・参照ファイル作成・予約タスクの実タブ読取確認は行っていません。

# GAS-Bの文字起こしタブ対応（最新）

43c7c14のGAS-Bはユーザーが作成・デプロイし、設定確認・予定一覧・DRY_RUNの登録とmoverRunが実機動作済みです。文字起こしがGeminiメモのタブに入るため待機していた差を修正し、DocsのincludeTabsContentで子タブを含め読み取り確認、manifest.transcript_sourceで所在を記録します。別ファイル優先を維持し、Docsサービス追加のみでOAuthスコープは追加しません。予約タスク指示文とSPECを更新。ローカル126件のテスト、build/check/smokeを確認済みです。手順はORGANIZER_TABS_UPDATE.md。実GAS実行・実ファイル移動・予約タスクの実タブ読取確認は行っていません。

# 段階3再試験と段階1GAS-B（最新）

dcb063eの段階3再試験はユーザー報告で合格。対象外ページ維持・日本語表示・競合自動再取得、一覧詳細5〜6秒／操作約9秒を確認済みです。ブラウザの強制再読み込みをガイドへ追記しました。本番DBへの確認状態追加は未実施です。

GAS-Bの本人登録・解除・時間トリガー、指定した自分主催Meetの添付移動・manifest・途中再開を追加しました。GAS-Aへの登録は本人のDrive更新者を検証する登録ファイル同期です。ローカル119件のテスト、build/check/smokeを確認済みです。試験手順はORGANIZER_TEST.md。実GAS作成・デプロイ・移動・所有権／予定添付リンク確認はユーザー側で未実施です。以下は各時点の履歴です。

# 段階3の修正（最新）

938489bの実機結果は本人識別・DRY_RUN・確定／修正／保留／再実行・version検知が合格。対象外がNotionのゴミ箱になるため、ユーザー復元後、確認状態selectに変更しました。setupReviewNotionStatusでテストDBだけを準備・既存状態同期します。表示キャッシュ、台帳／Drive取得の再利用、操作後1RPCへの短縮、JSON表示廃止、画面内確認・競合時の自動再取得を追加しています。ローカル103件のテスト、build/check/smokeを確認済みです。最新手順はREVIEW_UPDATE.md。実GAS実行・デプロイ・実サービス書き込み・実機速度の計測は行っていません。以下は各時点の過去記録です。

# 段階3の追加（最新）

ユーザー報告で069c759の段階2はfinance@・共有ドライブ_testで合格です。3行MTG-261021-01〜03、会議フォルダ3件、JSONの_done移動、Notion既存3件の再利用を確認済みです。Chatworkはトークンなしの予定ログだけです。

段階3タブ1の一覧・詳細・編集と5操作、台帳マスタのアクセス制御、version検知、再開用処理記録、テスト限定Notion更新を追加しました（当時の対象外のゴミ箱処理は最新版で廃止済み）。手順はREVIEW_TEST.md。GAS実行・デプロイ・実サービス書き込みは行っていません。ローカル88件のテスト、build/check/smoke、DOMモックによる一覧→詳細→操作RPC・動的文字列のエスケープを確認済みです。実ブラウザ／GASの表示・本人識別・実サービス反映はユーザー試験が必要です。以下は過去段階時点の記録です。

# 実装状況

## finance@・共有ドライブへの移行

Google側のGAS所有・共有ドライブ管理・ChatGPT所有／Drive接続はfinance@premiere-mode.co.jpへ変更しました。Notionのオーナー・内部インテグレーションはcontact@のままです。
ユーザーが既存の共有ドライブ、フォルダ、本番／テスト台帳、finance@のGASを作成済みです。この版の実行はまだありません。
`setupSharedTestWorkspace()` は既存構成を検証し、_testだけにマーカーを付け、不足フォルダ・台帳シート・サンプルマスタを準備します。_systemには書き込みません。
`docs/SHARED_DRIVE_TEST.md` を現行の実行ガイドとします。以下のマイドライブ代用・旧アカウントに関する項目は過去の検証経緯です。

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

台帳IDにはテスト用を設定してください。現在のGAS実行主体はfinance@premiere-mode.co.jpです。
`NOTION_DB_TLDV_INBOX` も開発中はテスト用DBを指定してください。
2DB構成のときは追加の `NOTION_DB_NONPROJECT_TEST` が必須です。
GAS-Bにも `DRY_RUN=true` を設定します。

## 実機で未確認の項目

- finance@premiere-mode.co.jpの新プロジェクトでの権限許可と接続確認
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
