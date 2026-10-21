# PC上のCodexによる生成（テスト限定）

## 今回の変更と確認できた範囲

d4a570eはユーザー実機で参照出力・MarkdownからのDoc・Notion作成まで合格。クラウド予約タスクのDriveアップロードは安全チェックで失敗しました。高リスクの「すべて許可」は使わず、OpenAI API方式も採用しません。クラウド予約タスクは停止し、生成を同時に走らせないでください。

ローカルCLIをChatGPT（premiere・Plus）でログインして起動します。APIキーは不要です。**モデルの推論はCodexのクラウドで行われ、会議本文を送信します。** PC上ではファイルの読取・保存だけを行います。利用枠・認証の期限・PCのスリープ・Drive未接続で停止する場合があります。失敗を成功扱いにはしません。

この開発環境で確認できるOSはLinux x86_64、CLIは0.163.0です。ユーザーのPCは見えておらず、OS・Driveパソコン版の有無・マウント先・ログイン状態は未確認です。Driveパソコン版はmacOS/Windows向けで、Linux版はありません。下のlaunchd例はmacOS用、cronは対応するマウントを用意できるPC向けです。Windows用タスクスケジューラは今回の対象外です。

Codexアプリのローカル自動化機能はアプリのバージョン・PCで要確認です。今回の手順はCLI＋launchdに統一します。CLIの対応機能は`codex exec --help`で確認し、`--ignore-user-config`と`--ignore-rules`が無い旧版では実行を拒否します。最新版へ更新してください。ChatGPT Plusで使えることはOpenAI公式GitHubのREADMEで確認し、フラグはCLI同梱ヘルプで確認しました（開発者サイト本文はこのネットワークから取得不可）。Plusでのログイン・無人実行・Drive同期はユーザーPCで次の順に実機確認します。

## 構成と権限

GAS-B moverRun → テスト受信のready manifest → GAS-A exportTranscriptTexts → transcript.txt＋manifest.transcript_text → Driveパソコン版 → ローカルrunner → inbox/local_{会議フォルダ}.json＋同名.ready.txt → GAS-A ingestInbox。

Codexは`-a never`（承認を待たず拒否）と`--sandbox read-only`で動きます。ツールによる書き込みはゼロです。個人のconfig・execpolicyを読み込まず（作業場所の祖先に別のproject configがある場合は起動を拒否）、Apps・MCP設定・プラグイン・hooks・shell・ブラウザ等を使わせません。Google接続・Notion接続・APIキーをCodexへ設定する必要はありません。スクリプトがmanifest/TXT/refだけを読み、入力として渡し、戻ったJSONをスキーマ・キー・PJ ID等で検証して保存します。これによりworkspace-writeより狭くします。

read-onlyサンドボックスは「他のファイルの読み取りも全て遮断する」という意味ではありません。今回の構成はツールを無効にし、必要資料を標準入力で渡します。PC全体の完全な読取隔離が必須なら専用OSユーザー等が別途必要です。CLI自体の認証・更新用通信は必要です。meeting資料内の指示には従わないプロンプトにしています。

生成用作業ファイルとロック・完了記録は_test/_local_codexに置きます。ログには文字起こし・モデルの生出力・秘密値を出しません。Codex自身の認証情報等は通常のユーザーディレクトリを使います（`--ephemeral`でセッション保存を抑制）。認証ファイルを共有ドライブへ移さないでください。_local_codexには議事録の生成結果が残るのでテスト領域の閲覧権限を確認してください。

## 1. finance@のGAS-Aへ反映

1. `dist/gas-core/Code.gs`でCode.gsを全文置換。既存dev.gsは残します。`dist/gas-core/appsscript.json`も反映してください。GAS-Aにサービス「Google Docs API」v1（識別子Docs）を追加。既存のdocuments/driveスコープで読み取り、OAuthスコープ追加はありません。標準Cloudプロジェクト利用時はDocs APIも有効にします。GAS-Bのコード・デプロイ更新は不要です。
2. 既存プロパティは保持し、次を確認します。NOTION_TOKENは変更しません。

| プロパティ | 値 |
|---|---|
| ENV | test |
| DRY_RUN | true（最初と試験終了時） |
| GENERATOR_MODE | LOCAL_CODEX |
| SHARED_DRIVE_ID | 0ALo4SlMVSpXdUk9PVA |
| FOLDER_SYSTEM_TEST_ID | 1pKWcGDuRCBf3VG0AfKBaKghE0nD3kYwW |
| FOLDER_INBOX_RAW_TEST_ID | 1Hip4qiyC3sUsPhqCj8JGAFKj8zLaUHaC |
| LEDGER_SPREADSHEET_ID | 1VrooNKgbSN5V579yk-m5Ag0j2atBcL_qFU1eQ5NSOTY |
| INGEST_BATCH | 5（未設定も5） |

TEST_ENV_KEY・本番/テストDB ID・台帳の重複防止記録も保持します。

3. 既に04として取り込まれた会議は受信から移動済みなので対象になりません。新しい短いテスト会議か未取り込みのready会議を使います。Bの指定予定を更新し、既存ガイドどおりDRY_RUNで確認→明示的なfalseでmoverRun→Bをtrueへ戻します。過去の台帳・NOTION_FIXTURE・処理済み記録を消して再投入しないでください。
4. Aの`exportTranscriptTexts()`をtrueで実行。会議キー・文字数・ハッシュ・作成予定だけ表示、Drive書込なし。
5. Aをfalseにし同関数を実行。指定タブ原文のtranscript.txtと、manifestの`transcript_text`（file_id/name/sha256/source/exported_at）ができます。元のDoc・録画・メモ本文は変更しません。manifestの既存内容を保ち、所在だけ追記します。別ファイルのGoogle Doc/text/plain文字起こしも対応します。複数タブを一意に選べない場合は停止します。
6. 再実行してTXTが増えずIDが同じことを確認。途中失敗でTXTだけ残った場合も、同内容なら再利用、異なるTXTなら上書きせず停止。追記済みmanifestは処理済みスナップショットとして維持します（元のDocが後から変わってもTXT更新なし）。Aをtrueへ戻します。

任意：`setupTranscriptExportTrigger()`はtrueで予定確認→falseで15分毎1個を作成。`removeTranscriptExportTrigger()`も同じ手順で自分の該当トリガーだけ解除します。生成トリガーではなくTXT出力用です。**AのDRY_RUN=trueのままでは定期TXT作成・ingestとも予定表示だけです。** 無人試験でfalseを維持するかは人が決め、必ずENV=testを維持します。今回Codexは設定変更・GAS実行をしていません。

AのWeb画面は変更していません。管理用関数の実行だけならWebアプリの新バージョン更新は不要です。

## 2. PC準備と手動確認（macOS例）

1. Googleドライブパソコン版をインストールしfinance@でログイン。Finderで共有ドライブ「MTG記録」→_system→_testを表示。共有ドライブは通常ストリーミングです。_testをオフライン利用可能にし、TXT・JSONのダウンロードと同期が終わるのを待ちます。.gdocは読まずTXTだけ使います。管理者アカウント全体をAIの接続ツールへ渡す設定は追加しません。
2. Node.js 20以上をPCへ用意し、`npm install -g @openai/codex`で最新版Codex CLIを導入。ターミナルで`codex login`を実行しChatGPTのpremiere・Plusでログイン、`codex login status`がChatGPTを示すことを確認。APIキー認証・OPENAI_API_KEYは使いません。Plusの利用枠を消費します。初回認証は対話操作が必要です。
3. PCにリポジトリworkを取得し`npm ci`。`command -v node`と`command -v codex`で絶対パスを控えます。以下の`/ABS/...`を実際のパスへ置換します。共有ドライブのパスはPCごとに違うため推測で埋めません。

```sh
/ABS/PATH/TO/node /ABS/PATH/TO/Notion/local/run.cjs --test-root '/ABS/PATH/TO/MTG記録/_system/_test' --codex /ABS/PATH/TO/codex
```

`--run`なしはDRY_RUN。TXTのハッシュを検証し「生成予定」か「TXT書き出し待ち」を表示するだけで、Codex起動もDriveフォルダへの書込もしません。範囲外・参照JSONの破損・同期途中は停止。ref不在だけは空として続行し、生成結果の確信度低・要確認への明記を必須にします。

```sh
/ABS/PATH/TO/node /ABS/PATH/TO/Notion/local/run.cjs --test-root '/ABS/PATH/TO/MTG記録/_system/_test' --codex /ABS/PATH/TO/codex --run
```

1回につき新規1会議、生成は最大4分です。承認要求は出さず拒否、認証・利用枠等の失敗は非ゼロ終了し、生成失敗ではinbox/{会議フォルダ}.error.txtを新規保存します。初期設定・入力同期段階の失敗はstderrだけです。既存ファイルは上書きしません。ログに未完了があれば原因を解決してから再試験します。

期待結果：inboxに`local_{会議フォルダ}.json`（minutes_doc_id=null・本文入り）と`.json.ready.txt`（JSONのSHA-256）が各1件。_local_codexに完了記録。再実行して同じ会議を生成しないこと。JSON→完了印の同期順が逆でも、GASはハッシュ一致まで待ちます。共有ドライブで未対応のhard linkや原子的renameには依存しません。

DriveのWeb画面でも2ファイルが届いたことを確認後、AのingestInboxをtrue→falseで実行し、既存どおりDoc/Notion/台帳を確認。TXTも会議フォルダへ移り、JSONと完了印はinbox/_doneへ移ります。Chatwork未設定なら予定ログだけ。最後にAをtrueへ戻します。

## 3. macOSの定期実行

1. 手動試験に合格してから、`local/jp.premiere-mode.minutes.plist.example`の全`/ABS/PATH/TO/...`を実パスに置き換え、`~/Library/LaunchAgents/jp.premiere-mode.minutes.plist`へ保存。XMLの`&`等はエスケープ。node・codexは絶対パスです。ランナーは両実行ファイルのディレクトリを子プロセスのPATHへ追加します。
2. 次で読み込みます。**ユーザーのPCでだけ実行**してください。

```sh
plutil -lint ~/Library/LaunchAgents/jp.premiere-mode.minutes.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/jp.premiere-mode.minutes.plist
launchctl kickstart gui/$(id -u)/jp.premiere-mode.minutes
```

15分間隔です。ログは_test/local-run.logとlocal-error.log。ユーザーがログインし、PCとDriveが使える必要があります。スリープ・電源オフ中は実行しません。復帰後の実行・OAuth更新は実機確認してください。定期実行が認証待ちで対話を始めることはなく、失敗したらターミナルで再ログインします。

停止：
```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/jp.premiere-mode.minutes.plist
```

cronを使う場合は`local/crontab.example`の絶対パスを置換し、`crontab -e`で追加。launchdと二重登録しないでください。Codexアプリの画面上の「スケジュール」は今回は使いません。

## 停止・復旧・残る実機確認

- 異常終了で_test/_local_codex/run.lockが残ったら、実行プロセスがいないことをPC上で確認してから、空のロックフォルダだけ`rmdir`します。業務ファイル・完了記録は消しません。
- JSONはあるが完了印がない/ハッシュ不一致なら「公開未完了」で停止。JSONを勝手に修復・上書きしません。生成結果を人が確認し、正しい内容ならそのJSONのSHA-256を同名.ready.txtへ新規保存して同期完了を確認します。既存の誤った印やJSONは削除せず保全して管理者と対応します。
- 会議キーの完了記録は再生成を防ぐ正本です。試験のために消しません。新しい会議で確認します。
- local_プレフィックスはこの方式専用。他の生成者は同じ名前を使わないでください。従来のJSONは完了印なしで互換維持します。
- 今回ローカルのモックで安全条件・ハッシュ同期・重複防止・Markdown互換を検証。PCの実Drive同期、Plus認証/利用枠、launchd、無人のend-to-endは未実施。高リスクのDriveツール許可は不要な設計です。

参照：[OpenAI公式README・ChatGPTプランでの利用（本文確認済み）](https://github.com/openai/codex#using-codex-with-your-chatgpt-plan)、Codex `codex exec --help` / `codex login --help`、[非対話実行](https://developers.openai.com/codex/noninteractive/)、[認証](https://developers.openai.com/codex/auth/)、[Docsタブ取得（本文確認済み）](https://developers.google.com/workspace/docs/api/how-tos/tabs)、[Driveパソコン版の利用](https://support.google.com/drive/answer/10838124)。
