**最新の本番手順は[GEMINI_NOTES_PRODUCTION.md](GEMINI_NOTES_PRODUCTION.md)。PC不要・社員Workspace登録・個人Gmail/tl;dv・Notion本番・Chatwork451196858に対応します。GAS-AはCalendar readonlyの追加認証、BはDOMAIN公開が必要です。以下は旧方式の履歴です。**

無人テスト運転の最新手順は[AUTOMATION_TEST.md](AUTOMATION_TEST.md)。A/BのコードとMac runnerを更新し、一度だけ設定・登録します。

Drive/Docs一時エラーの共通再試行は[GOOGLE_RETRY_UPDATE.md](GOOGLE_RETRY_UPDATE.md)を参照。今回スコープ変更・追加プロパティはありません。

現在の生成方式はPCのCodex CLI（LOCAL_CODEX）です。GAS-AへのDocsサービス追加とPC設定は[LOCAL_CODEX_TEST.md](LOCAL_CODEX_TEST.md)を参照してください。OpenAI API方式は採用しません。

# 主催者用GAS-Bの実装後の手順

GAS-Bの作成・設定・アクセスしているユーザーとしてのデプロイ・テスト会議による検証は [ORGANIZER_TEST.md](ORGANIZER_TEST.md) を参照してください。GAS-Aとは別プロジェクトです。段階3修正版のWeb画面がキャッシュされる場合はcmd+shift+Rで強制再読み込みしてください。

# 開発・接続確認

最新のfinance@・共有ドライブでの段階2検証は [共有ドライブ実行手順](SHARED_DRIVE_TEST.md) を使ってください。マイドライブ用の旧手順は代用構成を使う場合だけ参照します。

テストDB作成後の接続確認・Notionサンプル取り込みは [Notion検証手順](NOTION_FIXTURE_TEST.md) を参照してください。

テスト用Notion DBがまだない場合は、先に [テストDB初期作成手順](SETUP_TEST_DATABASES.md) を使います。
ポータルページ `3edca178-7419-808a-9039-d502914f7603` はDBではありません。

## ローカル検証

Node.js 20以上で、リポジトリのルートから実行します。

```sh
npm ci --cache /workspace/.npm-cache
npm run check
npm test
npm run smoke
npm run build
```

claspは開発依存に固定済みです。グローバルインストールは不要です。

## 今回使うGoogleアカウント

GASの所有者はユーザー指定の `finance@premiere-mode.co.jp` です。Apps Script右上のアカウント表示を確認し、作成済みの本体プロジェクトを開きます。Notionのオーナーと内部インテグレーションはcontact@のままです。ChatGPTのDrive接続もfinance@に変更済みです。Webアプリの公開はまだ行いません。

## Google側の準備

Googleに接続する際は、finance@premiere-mode.co.jpで操作します。クラウドにあるGoogle用の認証ファイルは、finance@premiere-mode.co.jpのApps Script権限を証明するものではありません。
APIキーやトークンはチャットやリポジトリに貼らず、Apps Scriptのスクリプトプロパティに入力します。

finance@の本体プロジェクト「MTG議事録自動化・本体」はユーザーが作成済みです。クラウド側のclaspには未接続です。以下は補助的な接続手順です。

### Apps Scriptエディタで読み取り確認

1. finance@premiere-mode.co.jpで作成済みの本体プロジェクトを開きます。主催者用は別途作成する段階です。
2. プロジェクト設定でマニフェストを表示し、それぞれ `gas-core/appsscript.json`、`gas-organizer/appsscript.json` の内容を設定します。
3. `npm run build` で生成する各 `dist/gas-core/Code.gs`、`dist/gas-organizer/Code.gs` を、それぞれのプロジェクトの `コード.gs` に貼ります。元の `src/` を個別に貼る方法と併用すると二重定義になるので、片方だけ使います。
4. 「サービス」に本体はDrive v3、主催者用はDrive v3とCalendar v3があることを確認します。標準Cloudプロジェクトを使う場合は対応APIも有効化します。
5. 本体のスクリプトプロパティを `config/script_properties.md` と `docs/IMPLEMENTATION.md` に沿って設定します。開発用DB・フォルダ・台帳だけを指定します。
6. まずNotionだけを確認する場合は、`ENV=test`、`DRY_RUN=true`、`NOTION_TOKEN`、`NOTION_DB_MINUTES_TEST`、`NOTION_DB_TASKS_TEST`、`NOTION_DB_TLDV_INBOX` を設定し、`checkNotionConfig()` を実行します。この時点ではDrive・Chatworkの設定は不要です。全体の不足確認には `checkConfig()` を使います。
7. 不足を解消したら `dumpNotionSchemas()` を実行し、Googleの権限許可を行います。Notion側でもテストDBを内部インテグレーションに共有する必要があります。戻り値の `differences` に仕様との相違が出ます。
8. 取得したプロパティ名・型をSPECと照合します。ここまでNotionへの書き込みはありません。

`initLedger()` と `registerFolders()` はDRY_RUNの計画専用です。段階0の実機完了とは扱いません。
トリガー・Webアプリはまだ作成・公開しないでください。

### claspを使う場合

認証するPCでリポジトリを開き、`npm ci` 後、`npx clasp login` をfinance@premiere-mode.co.jpで行います。
Google Apps Scriptのユーザー設定でApps Script APIを有効化してください。
既存の2プロジェクトそれぞれに、以下のローカル設定を作成します。IDは秘密トークンではありませんがGit管理しません。

`gas-core/.clasp.json`：

```json
{"scriptId":"本体プロジェクトのID","rootDir":"."}
```

`gas-organizer/.clasp.json`：

```json
{"scriptId":"主催者用プロジェクトのID","rootDir":"."}
```

`cd gas-core` または `cd gas-organizer` の後、`../node_modules/.bin/clasp status` で対象ファイルを確認します。
既存のコードがあるプロジェクトへのpushは上書きになるため、事前にバックアップし、新規の開発用プロジェクトだけを使ってください。
その後 `../node_modules/.bin/clasp push` でコードを送ります。これは実行やWebアプリ公開とは別です。
認証情報ファイルはクラウドやGitにコピーしないでください。
