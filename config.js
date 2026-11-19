/* ============================================================
 * わだちログ 設定ファイル（config.js）
 *  GAS のウェブアプリURLを変えたときは、このファイルだけ書き換えてください。
 *  ※ /exec で終わるURLだけを入れる（後ろに文字を残さない）
 * ============================================================ */
window.WADACHI_CONFIG = {
  // GAS ウェブアプリのURL（［デプロイ］→［デプロイを管理］で確認）
  GAS_URL: 'https://script.google.com/macros/s/AKfycbwXbfaUtU6Vf8cwjY0z7GpMz8U5HTz6XqUjTjEQfFGxF01BMjYEMOio0kzrGl2CCbSn_Q/exec',
  // 公開URL（LINEなどで送るトリップのリンクに使います）
  APP_URL: 'https://kenken6291.github.io/wadachi-log/',

  // 既定のGeminiモデル（利用者が画面で選ばなかったときに使う）
  //   空文字 '' = 自動（汎用の最新モデル）
  GEMINI_MODEL: '',

  // 画面の「AIモデル」選択肢（value が API のモデルID）
  //   選んだモデルが使えない（廃止・未公開・名前違い）ときは、
  //   GAS側で汎用の最新モデルへ自動で切り替わります
  GEMINI_MODEL_OPTIONS: [
    { value: '',                  label: '自動モード（汎用の最新）' },
    { value: 'gemini-4-hydrogen', label: '4 Hydrogen（日々の暮らしをサポート）' },
    { value: 'gemini-4-neon',     label: '4 Neon（Deeper analysis）' },
    { value: 'gemini-4-carbon',   label: '4 Carbon（Code & complex work）' },
    { value: 'gemini-4-argon',    label: '4 Argon' },
    { value: 'gemini-3.8-flash',  label: '3.8 Flash' },
    { value: 'gemini-3.5-flash',  label: '3.5 Flash' }
  ]
};
