# 管理者によるWorkspace会議の一括収集

6c9c653の本番稼働は2026-10-23にユーザー実機で合格済みです。本変更の委任認証・権限はまだ実機未検証です。Google Cloud／管理コンソール／GASの操作はfinance@の管理者が行います。外部AI API、PC、Codex定期実行は使いません。個人Gmailはドメイン全体の委任の対象外で、既存のtl;dv経路を続けます。

## 構成と既存運用の維持

**管理者収集も既存のGAS-B「主催者用」に追加します。GAS-Aの変更・再デプロイは不要です。** Aへ追加すると取り込みの実行時間とロックを圧迫し、新しいCプロジェクトではBとScriptLock／ScriptPropertiesを共有できません。同じBなら、各自登録①と管理者収集②が一つのScriptLock内で同じ会議キーを判定できます。Aの15分統合tick・Notion・Chatwork設定はそのままです。

- ①：これまでどおり本人が一度登録し、本人の時間トリガーで収集。
- ②：finance@の15分トリガーがDirectoryとライセンス一覧を読み、各対象ユーザーを委任。本人の登録・同意・トリガー作成は不要。
- 両方とも同じ移動・manifest生成処理。readyを最後に作り、共有処理済み記録へ登録。途中失敗は同じID・フォルダから再開。
- **別のGAS-Cにコードをコピーして並行稼働させないでください。** ロックはプロジェクト単位です。移行済みプロジェクトIDも検査します。
- 従来の `appsscript.json` は変更していません。コードだけ更新してSAを設定しなければ①のままです。②を使うときだけ、後述の委任版マニフェストに切り替えます。

## 1. Google Cloud側の準備（管理者）

1. [Google Cloud Console](https://console.cloud.google.com/)の上部プロジェクト選択 → **新しいプロジェクト**。例「MTG議事録・管理者収集」。GAS-Bが現在接続しているCloudプロジェクトは変更しません。SA用プロジェクトは別でも動きます。
2. **APIとサービス → ライブラリ**で次を検索し、有効化します。
   - Admin SDK API
   - Enterprise License Manager API
   - Google Calendar API
   - Google Drive API
   - Google Docs API
3. **IAMと管理 → サービスアカウント → サービスアカウントを作成**。例「minutes-collector」。プロジェクトのオーナー・編集者等のIAMロールは付けません。Workspace委任とDrive上の権限を使います。
4. 作ったサービスアカウントの**詳細 → 詳細設定／ドメイン全体の委任**でOAuth 2クライアントID（数字）を確認します。「ドメイン全体の委任を有効にする」が表示される場合は有効化。鍵JSONの `client_id` と同じ値を後述の管理コンソールに登録します。SAのメールアドレスやプロジェクト番号とは異なります。
5. **鍵 → 鍵を追加 → 新しい鍵を作成 → JSON**。組織ポリシーで禁止されている場合は管理者に正規の承認・設定を依頼します。
6. JSON全文は後述のGAS-Bスクリプトプロパティ `SA_KEY_JSON` に人が貼ります。チャット、Git、台帳、Drive共有フォルダ、ログには置きません。

既存GAS-BのAdvanced Drive/Calendar/Docsサービスは維持します。Admin SDK／LicensingのGAS拡張サービスやOAuthライブラリの追加は不要です。

## 2. 管理コンソール側の委任（特権管理者）

[管理コンソール](https://admin.google.com/) → **セキュリティ → アクセスとデータ管理 → APIの制御 → ドメイン全体の委任を管理 → 新しく追加**。UIによってはAPIの制御ページの下部に「ドメイン全体の委任」があります。特権管理者が必要です。

クライアントIDに上記の数字を入力し、OAuthスコープに次の4つをカンマ区切りで登録します。

```text
https://www.googleapis.com/auth/calendar.readonly,https://www.googleapis.com/auth/drive,https://www.googleapis.com/auth/admin.directory.user.readonly,https://www.googleapis.com/auth/apps.licensing
```

| スコープ | 用途 |
|---|---|
| calendar.readonly | 各本人のprimary予定・添付IDをGETするだけ |
| drive | 本人所有ファイルを共有受信へ移動。DocsのタブGETもこのスコープで可。readonlyやdrive.fileでは既存の全Meet添付の移動を満たせない |
| admin.directory.user.readonly | finance@としてユーザー・停止状態・OU・部署をGETするだけ |
| apps.licensing | finance@としてGoogle Workspaceの割当ライセンス一覧をGETするだけ |

**License Managerには読み取り専用OAuthスコープがありません。apps.licensingは権限としてはライセンス変更も可能ですが、実装はGET以外を禁止しています。** Directoryの `isMailboxSetup` 等をライセンスの代用にしていません。finance@にはDirectory／ライセンス一覧の閲覧権限が必要です。API・委任・権限のエラー時は「全員ライセンスあり」とせず停止します。Google側の委任反映には時間がかかることがあります。

## 3. Driveの権限（管理者が一度設定）

委任は本人と同じ権限であり、**finance@が管理者でも社員のDrive権限を自動で迂回できません**。対象社員が共有ドライブ受信に追加・移動できる権限を管理者が設定してください。既に①を使える人の権限はそのまま使えます。

機密を含む共有ドライブ全体を社員全員へ公開する必要はありません。社内ポリシーに従い、受信フォルダだけを対象者・グループへ共有できるか確認してください。共有ドライブの「非メンバーへの共有」制限や移動能力によって可否が異なります。自動でACLを広げる処理はありません。まず1ユーザーで実際に移動し、元の予定添付から開けることまで確認します。移動できない場合はコピーや所有権変更APIで回避せず要確認にします。

## 4. GAS-Bへ反映（finance@）

既存の「主催者用」プロジェクトを開き、次を反映します。

- `dist/gas-organizer/Code.gs` でCode.gsを全文置換。Register.htmlは従来どおりで変更なし。
- ②の準備時に `dist/gas-organizer/appsscript.delegated.json` の内容を、GASの **appsscript.json** に貼ります。委任版という別名のファイルをGASへ追加するのではありません。
- 追加されるGAS側のスコープは `script.external_request` だけです。上記4つの委任スコープをGASマニフェストに追加しません。
- finance@で下記のプレビュー関数を手動実行し、UrlFetchの追加同意を済ませます。
- Webアプリは**デプロイ → デプロイを管理 → 編集 → 新バージョン → デプロイ**。本人実行 `USER_ACCESSING`／組織内 `DOMAIN` を維持します。URLを変えません。画面が古ければ強制再読み込みします。

スコープ追加時、既存の①登録者には再同意が必要になる場合があります。現在実機確認済みのfinance@はここで再同意します。他の登録者がいる場合は②の切替を同時に進め、管理者収集でカバーします。①を引き続き使う人だけは登録画面での追加同意が必要です。既存トリガーが新しいスコープを無条件に使えるとは扱いません。①だけを維持する段階では通常版マニフェストのままにしてください。

### スクリプトプロパティ

本番の既存値は維持します。**GAS-Aは変更しません。** `preview...` はローカルの設定コピーをDRY_RUNにするため、本番Bの `DRY_RUN=false` を切り替えず確認できます。

| キー | 設定値 |
|---|---|
| ENV / DRY_RUN | 既存の `prod` / `false` を維持。test検証ではtestの設定一式 |
| SHARED_DRIVE_ID | `0ALo4SlMVSpXdUk9PVA` |
| FOLDER_SYSTEM_ID | `1UbflVH7ITQBN6INYyAQyn7fy77CWl4wH` |
| FOLDER_INBOX_RAW_ID | 本番 `1jNifZBBUN0QNMWdA_hI2J5YY2PbqtxoB` |
| PRODUCTION_START_AT | `2026-10-23T14:30:00+09:00`（変更しない） |
| MOVER_MODE / MOVER_WAIT_MIN / MOVER_MEMO_WAIT_MIN | `AUTO` / `20` / `20`（既存値を維持） |
| SA_KEY_JSON | 人が鍵JSON全文を貼る。秘密値 |
| DWD_CUSTOMER_ID | 管理コンソール **アカウント → アカウント設定 → プロフィール → お客様ID** の `C...`。my_customerやドメイン名は不可 |
| MOVER_SHARED_REGISTRY | `true`。①②で同じScriptPropertiesを使う |
| DWD_ENABLED | 最初 `false`。単一ユーザーの試験後だけ `true` |
| DWD_TEST_USER_EMAIL | 最初 `finance@premiere-mode.co.jp`。次に記録機能のある社員1名の会社メール |
| DWD_EXCLUDE_EMAILS | 任意。除外メールをカンマ／改行区切り |
| DWD_EXCLUDE_ORG_UNITS | 任意。例 `/記録対象外`。配下OUも除外。`/` は全員除外 |
| DWD_EXCLUDE_DEPARTMENTS | 任意。Directoryのorganizations.departmentと完全一致、カンマ／改行区切り。OUとは別 |
| DWD_ALLOWED_SKUS | 任意。許可するGoogle-AppsのSKU IDをカンマ区切り。空ならGoogle-Appsの割当がある人。録画機能の有無は添付の到着で確認 |
| DWD_BUDGET_SEC | `210`。30〜240秒。API応答待ちを含めた厳密な停止タイマーではなく、次の予定へ進む前の時間予算 |
| DWD_EVENTS_PER_USER | `20`。1〜50。1人の走査で他の人が後回しになり続けるのを防ぐ |
| MOVER_RETIRE_PERSONAL_TRIGGERS | 最初 `false`。全員の走査が正常と確認できた後のみ `true` |

testでは従来の `FOLDER_SYSTEM_TEST_ID=1pKWcGDuRCBf3VG0AfKBaKghE0nD3kYwW`、`FOLDER_INBOX_RAW_TEST_ID=1Hip4qiyC3sUsPhqCj8JGAFKj8zLaUHaC` を使います。ENVの異なる記録は共用しません。

`MOVER_SHARED:*`、`MOVER_REGISTRY_MIGRATED:*`、`DWD_REGISTRY_SCRIPT_ID`、`DWD_CURSOR:*`、`DWD_NEXT:*`、`DWD_COVERED:*`、`DWD_EXCLUDED:*`、`DWD_LAST_RUN:*` は自動管理です。手で編集・移行しません。処理済み記録は検索期間72時間より長い7日間保持して整理します。台帳を社員に編集共有する必要はありません。

## 5. 実行順と期待結果

1. `previewMoverProcessedRecords()`：既存manifestの共有処理済み記録への移行予定件数だけ表示。Aがすでに業務フォルダへ動かしたmanifestも対象。DriveやScriptPropertiesは更新しません。
2. `migrateMoverProcessedRecords()`：既存DRY_RUN=falseなら共通記録を作成。Driveファイルは変更しません。同名manifestの複製もしません。移行完了前は②の実行・実トリガー作成を拒否します。
3. `previewDelegatedMeetings()`：Directory一覧人数、停止・未ライセンス・除外判定後の対象人数、今回走査した本人会議、移動予定を表示。Drive・処理済み記録・カーソルを更新しません。private／【記録なし】／cutoff以前／終了待ち／添付なしは静かに対象外。未決の添付は待機・要確認です。
4. `DWD_TEST_USER_EMAIL=finance@...` で `previewDelegatedSingleUser()` → `runDelegatedSingleUser()`。`DWD_ENABLED=false` のまま1ユーザーだけ実移動できます。新しい短い実音声の会議で録画・Geminiメモ・「会議を文字起こし」をオンにし、終了20分後に試験。受信への移動、ready manifest、ファイルID維持、元添付からの閲覧を確認。
5. 別の会社Workspace社員1名を `DWD_TEST_USER_EMAIL` に設定して同じ順で試験。**社員の登録画面操作なし**で本人主催の添付だけ移動することを確認。記録なしのライセンスなら添付なしのまま静かに対象外。元の会議別My Driveフォルダは空で残します。
6. `DWD_ENABLED=true` → `setupDelegatedMoverTrigger()`。finance@の `delegatedMoverTick_` を15分ごとに1個作成。①のタイマーは消しません。Aの既存統合tickが通常どおりDoc・Notion・Chatworkへ進めます。
7. `checkDelegatedStatus()` で対象人数・今回人数・エラー数・最終実行・次ユーザーを確認。GASの「実行数」でも15分の実行を確認。人数が0の場合はライセンス・顧客ID・除外設定を見直し、取得失敗を「未ライセンス」と誤認しないでください。
8. ②で全対象者の走査が正常に終わるまでは①を併用。確認後 `MOVER_RETIRE_PERSONAL_TRIGGERS=true`。各自トリガーは次回実行時、本人の正常走査が48時間以内、管理者の実行成功が1時間以内と確認できた場合だけ、自分のトリガーを停止します。社員の解除操作は不要。対象外／未走査／エラーの人は停止しません。GASの仕様上、finance@から他人のインストール型トリガーを直接列挙・削除することはできません。

社員数・予定数が多い場合、1回で全件を走査したと見なさないでください。結果の `continued=true` は同じ人の次ページ／残り予定を次回へ継続、`visitedUsers<eligibleUsers` は次のユーザーから再開です。プレビューは時間・件数制限内の今回分だけで、永続カーソルを進めません。1周が72時間を超える規模では対象を絞る等の設計見直しが必要です。

## 6. 無人通し・回帰確認

- finance@と、記録機能のある会社社員が各1件の新しいMeetを主催。社員はB登録不要。各会議でGeminiメモ／録画／文字起こしをオンにする。
- 関数を手で動かさず、Bの15分収集 → Aの15分取り込み → 本番Notionの1ページ → Chatwork451196858の1通知を確認。終了待ち20分にタイマー待ちが加わります。Googleの添付作成遅延分は追加で待ちます。
- ①登録済みfinanceの会議でも受信フォルダ・manifest・台帳行・Notionページ・通知が1件ずつであること。
- 非公開、【記録なし】、除外社員／OUの予定は移動しないこと。明示の人・部署除外は①にも反映（部署は②のDirectory取得後）。停止／未ライセンスは②では対象にしません。
- メモだけなら待機後notes_onlyとして「文字起こしなし・メモから作成」。何も記録されない予定は移動しないこと。
- 同じ予定の再走査で「処理済み」となり、Aが移動済みの元添付も再移動しないこと。testの記録を本番へ流さないこと。

## 7. 停止・鍵の管理

- **停止**：`removeDelegatedMoverTrigger()` をDRY_RUN=falseで実行。管理者収集のトリガーだけ解除し、DWD_ENABLED=falseにも戻します。A・データ・個別トリガー・処理済み記録は削除しません。①を自動停止済みの人まで①へ戻す場合は本人の再登録が必要です。移行初期は自動停止をfalseにしておくと戻しやすくなります。
- GAS-Bの編集者はfinance@等の必要な管理者だけ。社員にはWebアプリの利用だけを許可。ScriptPropertiesを読める編集者にはSA鍵へもアクセスできます。
- 鍵は組織の秘密情報保管庫で管理し、メール・Chatwork・Notion・Git・共有Drive・ログへ貼らない。ダウンロードJSONは安全に保管した後、不要なローカルコピーとクリップボード履歴を整理。
- **ローテーション**：CloudのSA「鍵」で新しいJSONを作成 → 人がSA_KEY_JSONを差し替え → プレビューと単一ユーザー試験 → 古い鍵を無効化／削除。鍵IDが変わればキャッシュを使い回しません。共通処理済み記録は維持。
- **漏えい**：Cloudで漏れた鍵を直ちに無効化／削除。必要ならSA自体を無効化し、管理コンソールの該当クライアントのドメイン全体の委任も削除。Bの管理者トリガー停止、関係する監査ログを確認。発行済みアクセストークンは有効期限まで残る可能性があるため、鍵削除だけで即時の完全失効とは考えません。正常な鍵・委任を再設定して試験後に再開。
- トークンはScriptCacheだけで約50分以内、鍵・JWT・トークン・APIエラー応答本文をログ／台帳へ保存しません。ログは人数・会議キー・移動予定・安全なHTTPコードまでです。

## 公式仕様の参照

- [サービスアカウントのJWTとドメイン全体の委任](https://developers.google.com/identity/protocols/oauth2/service-account)
- [Directory users.list](https://developers.google.com/workspace/admin/directory/reference/rest/v1/users/list)
- [License assignments listForProduct](https://developers.google.com/workspace/admin/licensing/v1/reference/licenseAssignments/listForProduct)
- [Workspace製品・SKU](https://developers.google.com/workspace/admin/licensing/v1/how-tos/products)
- [Calendar events.list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Drive files.update](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/update)
- [Docs documents.get](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/get)
- [Apps Scriptのインストール型トリガーの制約](https://developers.google.com/apps-script/guides/triggers/installable)
