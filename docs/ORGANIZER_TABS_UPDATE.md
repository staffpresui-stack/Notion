# GAS-B：Geminiメモ内の文字起こしタブへの対応

ユーザーの実機では、Calendar添付は録画とGeminiメモの2件で、メモ文書の「文字起こし」タブにトランスクリプトが保存されていました。この版はそのタブをDocs APIで読み取り確認し、通常の待ち時間（MOVER_WAIT_MIN）経過後、48時間待たずにreadyにします。別ファイルの文字起こしも引き続き扱い、両方ある場合は別ファイルを優先します。

## finance@での反映

1. **GAS-B（主催者用）**のコード.gsを `dist/gas-organizer/Code.gs` で全文置換し、HTMLのRegisterも `dist/gas-organizer/Register.html` で更新します。
2. `dist/gas-organizer/appsscript.json` を反映します。**Google Docs API v1（サービス名Docs）** を追加しました。左のサービスにDocsがあることを確認してください。標準Cloudプロジェクトを使っている場合はGoogle Cloud側でもGoogle Docs APIを有効にします。
3. OAuthスコープは増やしていません。Docsのdocuments.getは既存のDrive権限で実行でき、文書本文・タブの変更は行いません。認証確認が出る場合はfinance@で確認します。
4. 既存Webアプリを「デプロイを管理」→編集→**新バージョン**で更新します。実行はアクセスしているユーザー、アクセスは自分のみを維持し、cmd+shift+Rで強制再読み込みします。
5. 追加プロパティはありません。DRY_RUN=true、MOVER_TEST_EVENT_IDが今回のテスト予定のAPI IDであることを確認し、`moverRun()`または「今すぐ確認する」を実行します。ログのtranscript_sourceと画面に「Geminiメモ内タブ」が出て、missingにtranscriptがなく、物理ファイルの移動予定が2件になることを確認します。
6. 実際の移動を試すときだけDRY_RUN=falseにし、未登録なら画面で登録後、moverRunを実行します。録画とメモの2件だけを移動し、readyのmanifestを作成します。元の会議別サブフォルダは移動・削除しません。既存トリガーやUserPropertiesは消さずに使えます。
7. テスト会議2件はMOVER_TEST_EVENT_IDを1件ずつ切り替えて確認します。待機中だった会議はそのまま再実行できます。処理済みの会議は自動で再処理・上書きしません。最後にDRY_RUN=trueへ戻します。

GAS-Aのコード・設定・デプロイはこの修正では変更不要です。GAS-Aはmanifest.filesにある物理ファイルだけを扱い、同じメモを二重移動しません。

## manifestの期待値

メモ内タブ方式では次のように記録します。

```json
{
  "files": {"recording": "録画のID", "gemini": "メモ文書のID"},
  "transcript_source": {
    "type": "document_tab",
    "file_id": "メモ文書のID",
    "tab_id": "実際の文字起こしタブID",
    "tab_title": "文字起こし"
  },
  "missing": [],
  "status": "ready"
}
```

別ファイル方式では従来どおりfiles.transcriptを保持し、transcript_sourceは `{"type":"file","file_id":"文字起こし文書のID"}` です。未到着ならnullです。同じ文書IDをfiles.geminiとfiles.transcriptへ二重登録しません。

子タブも探索します。タブ名は「文字起こし」「Transcript」（前後空白、全半角、英字大小を正規化）を対象とし、同名候補が複数なら停止します。該当タブがなければ従来の待機・48時間後のmissing処理を維持します。Docs APIの未設定や読み取り権限エラーは「文字起こしなし」に置き換えず移動前に停止します。

## 予約タスクの指示文も更新

`prompts/chatgpt_scheduled_task.md` をfinance@の予約タスクへ反映してください。この版のパスは `_system/_test` です。本番への切替は人の承認後です。

指示文はtranscript_sourceのfile_idとtab_idに従って実際の文字起こしタブを読む形にしました。接続機能が指定タブを読めない場合は、メモの要約で代用せず、議事録・判定JSONの生成を止めてエラー理由を記録します。予約タスクの実際のタブ読み取り可否は、このコードのローカルテストだけでは確認できません。

公式仕様：[Docs documents.get](https://developers.google.com/workspace/docs/api/reference/rest/v1/documents/get)、[タブの操作・読み取り](https://developers.google.com/workspace/docs/api/how-tos/tabs)。
