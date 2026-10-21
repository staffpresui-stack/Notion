# 開発・接続確認

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

GASの所有者はユーザー指定の `staff.presui@gmail.com` です。Apps Script右上のアカウント表示で確認してから、新規の開発用プロジェクトを作成します。Webアプリの公開はまだ行いません。会社の共有ドライブへの権限は別途確認します。

## Google側の準備

Googleに接続する際は、staff.presui@gmail.comで操作します。クラウドにあるGoogle用の認証ファイルは、staff.presui@gmail.comのApps Script権限を証明するものではありません。
APIキーやトークンはチャットやリポジトリに貼らず、Apps Scriptのスクリプトプロパティに入力します。

現時点ではGASプロジェクトを作成・接続していません。段階0のコードを使う方法は次の2つです。

### Apps Scriptエディタで読み取り確認

1. staff.presui@gmail.comでApps Scriptを開き、本体用・主催者用の2プロジェクトを作成します。
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

認証するPCでリポジトリを開き、`npm ci` 後、`npx clasp login` をstaff.presui@gmail.comで行います。
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
