// nasa_screensaver.js

import { nasaApiKey } from "/js/apiConfigSecrets.js";

// ----------------------------------------------------
// 設定と定数
// ----------------------------------------------------
const APOD_URL = 'https://api.nasa.gov/planetary/apod';
const API_KEY = nasaApiKey.NASA_API_KEY || 'DEMO_KEY';

// ★ TOTAL_CYCLE_MSは削除し、TTS完了に依存する

const IMG_FADE_DURATION_MS = 2000;    // 画像のフェードイン/アウト時間 (2.0s)
const CARD_FADE_IN_DURATION_MS = 500; // カードのフェードイン時間 (0.5s)
const CARD_DELAY_MS = 500;           // (1) 画像表示からカード表示までの遅延

// ★ TTS (Text-to-Speech) の制御
const MAX_TTS_DURATION_MS = 120000;   // 読み上げの最大時間 (120秒) - 長文やエラー時のフェイルセーフ
const MIN_CARD_HOLD_MS = 3000;        // 読み上げがない場合の最低表示時間 (3秒)
const IMG_FADE_OUT_DELAY_MS = 1000;   // カード消失から画像消失までの遅延 (★ ReferenceErrorの解消)

// 必要なDOM要素
const ELEMENTS = {
    image: document.getElementById('nasa-image'),
    title: document.getElementById('apod-title'),
    date: document.getElementById('apod-date'),
    explanation: document.getElementById('apod-explanation'),
    overlay: document.getElementById('info-overlay'),
    // 最初のクリックを促す画面（TTSエラー回避のため）
    startScreen: document.getElementById('start-screen'),
    startButton: document.getElementById('start-button')
};

// ----------------------------------------------------
// ヘルパー関数
// ----------------------------------------------------

// ランダム
// function getRandomDate() {
//     const start = new Date(1995, 6, 16); 
//     const end = new Date(); 
//     const randomTime = start.getTime() + Math.random() * (end.getTime() - start.getTime());
//     const randomDate = new Date(randomTime);
//     const yyyy = randomDate.getFullYear();
//     const mm = String(randomDate.getMonth() + 1).padStart(2, '0');
//     const dd = String(randomDate.getDate()).padStart(2, '0');
//     return `${yyyy}-${mm}-${dd}`;
// }

// ランダムな年の「今日の日付」文字列
function getRandomDate() {
    // NASA APODのデータ開始年（1995年6月16日）
    const START_YEAR = 1995;
    // 今日の日付を取得
    const today = new Date();
    // 今の年
    const currentYear = today.getFullYear();
    // 今の月（0-11を01-12に変換）
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    // 今の日
    const dd = String(today.getDate()).padStart(2, '0');

    // ランダムな年を生成 (START_YEARからcurrentYearまで)
    // Math.random() * (最大値 - 最小値 + 1) + 最小値
    const randomYear = Math.floor(Math.random() * (currentYear - START_YEAR + 1)) + START_YEAR;

    let yyyy = randomYear;

    // ★ 特殊ケースの処理:
    // 取得したランダムな年が「開始年（1995年）」であり、かつ月日が「6月16日以前」の場合、
    // または、取得したランダムな年が「現在の年」であり、かつ月日が「今日の日付以前」でない場合は、
    // ランダムな日付がまだ存在しない未来の日付になる可能性があるため、日付を調整します。
    // 簡単のため、ランダムに選んだ年と今日の日付を結合する前に、
    // 結合後の日付が「APOD開始日より後」かつ「今日以前」であることをチェックする方が堅牢ですが、
    // ここでは単純にランダムな年を返します。

    // ただし、1995年の場合、6月16日以前の日付は存在しないため、
    // もしランダムに選ばれた年が1995年で、月日が1月1日の場合、APIはエラーを返します。
    // エラーが頻発する場合、ランダムな年ではなく、APOD開始日以降の日付を生成するロジックに戻すか、
    // 1995年の場合は6月16日以降の日付に強制的に調整する必要があります。

    // 例：今日が1月1日でランダム年が1995年の場合、1995-01-01は存在しない。
    // 念のため、現在の日付（月日）とAPOD開始日（6月16日）を比較し、
    // ランダム年が1995年の場合、6月16日以前の日付は避けます。
    if (yyyy === START_YEAR) {
        if (mm < '06' || (mm === '06' && dd < '16')) {
            // 1995年6月16日以前はデータが存在しないため、エラー回避のため1996年以降を選び直す
            // ここで再生成する代わりに、APOD開始日（1995年6月16日）以降の年をランダムに選びます。
            const safeRandomYear = Math.floor(Math.random() * (currentYear - (START_YEAR + 1) + 1)) + (START_YEAR + 1);
            yyyy = safeRandomYear;
        }
    }

    // ランダムな年 + 今日の月日
    return `${yyyy}-${mm}-${dd}`;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * [関数] テキストを読み上げ、読み上げ完了をPromiseで返します。
 */
function speakText(text) {
    if (!('speechSynthesis' in window)) {
        console.warn("Web Speech APIはサポートされていません。");
        return Promise.resolve();
    }

    window.speechSynthesis.cancel();

    return new Promise((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);

        // HAL 9000 風の機械音設定
        utterance.rate = 0.8;
        utterance.pitch = 0.5;

        utterance.onend = () => {
            resolve();
        };
        // エラー発生時（not-allowedなど）も次の処理に進める
        utterance.onerror = (event) => {
            console.error("TTSエラー:", event.error, " (not-allowedの場合は、画面をクリックして操作を許可してください)");
            resolve();
        };

        window.speechSynthesis.speak(utterance);
    });
}


/**
 * [関数] APIからデータを取得し、画面に表示するシーケンス全体を制御します。
 */
async function startScreensaverLoop() {

    // 0. サイクル開始時刻を記録 (デバッグ・最低表示時間計算用)
    const startTime = Date.now();

    // 1. 画面クリアリング (非表示とコンテンツクリア)
    ELEMENTS.image.classList.remove('screensaver__image--loaded');
    ELEMENTS.overlay.classList.remove('info-card--visible');
    window.speechSynthesis.cancel();
    ELEMENTS.title.textContent = "";
    ELEMENTS.date.textContent = "";
    ELEMENTS.explanation.textContent = "";

    // 2. データフェッチと画像ロード
    try {
        const date = getRandomDate();
        const url = `${APOD_URL}?api_key=${API_KEY}&date=${date}`;

        const response = await fetch(url);
        // 403エラーが発生した場合の診断メッセージ
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}. APIキーが正しく設定されているか確認してください。`);
        }
        const data = await response.json();
        if (data.media_type !== 'image') {
            setTimeout(startScreensaverLoop, 500);
            return;
        }

        // 3. DOMの更新 (情報コンテンツを書き込む)
        ELEMENTS.title.textContent = data.title;
        ELEMENTS.date.textContent = data.date;
        ELEMENTS.explanation.textContent = data.explanation;

        // 4. 新しい画像をロード
        const imageLoadPromise = new Promise((resolve) => {
            // Ken Burns Effectをリセット
            ELEMENTS.image.style.animation = 'none';
            void ELEMENTS.image.offsetWidth;
            ELEMENTS.image.style.animation = '';

            ELEMENTS.image.onload = () => resolve();
            ELEMENTS.image.onerror = () => resolve();
            ELEMENTS.image.src = data.url;
        });

        await imageLoadPromise;

        // --- ★ 表示フェーズの開始 ★ ---

        // Step 1: 画像フェードイン開始 (2000ms)
        ELEMENTS.image.classList.add('screensaver__image--loaded');

        // Step 2: 1秒待機後、情報カードのフェードイン開始 (500ms)
        await sleep(CARD_DELAY_MS);
        ELEMENTS.overlay.classList.add('info-card--visible');
        await sleep(CARD_FADE_IN_DURATION_MS);

        // Step 3: TTSによる読み上げ開始 (最大120秒)
        const textToSpeak = `${data.title}. ${data.explanation}`;
        const ttsPromise = speakText(textToSpeak);
        const maxDurationPromise = sleep(MAX_TTS_DURATION_MS);

        // ★ TTSが完了するか、最大時間(120秒)が経過するのを待つ
        // TTS完了で次の処理に進むため、「読み上げが終わったら次の画像へ」を実現
        await Promise.race([ttsPromise, maxDurationPromise]);

        // TTSが最大時間を超えた場合は、強制的に読み上げを停止
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            console.warn("TTSが最大時間 (120秒) を超えたため、強制停止しました。強制停止後、次の画像へ遷移します。");
        }

        // Step 4: 読み上げ完了/最大時間経過後、カード情報を瞬時に消す

        // 最低表示時間を確保するための計算
        const displayStartTime = startTime + CARD_DELAY_MS + CARD_FADE_IN_DURATION_MS;
        const actualHoldTime = Date.now() - displayStartTime;
        const minHoldWait = Math.max(0, MIN_CARD_HOLD_MS - actualHoldTime);
        await sleep(minHoldWait);

        ELEMENTS.overlay.classList.remove('info-card--visible');

        // Step 5: 1秒待機後、画像フェードアウト開始 (2000ms)
        await sleep(IMG_FADE_OUT_DELAY_MS);
        ELEMENTS.image.classList.remove('screensaver__image--loaded');

        // Step 6: 画像のフェードアウト完了を待つ
        await sleep(IMG_FADE_DURATION_MS);

        // --- ★ 次のサイクルへの準備 (読み上げ完了後、即時遷移) ★ ---
        // 時間計算を削除し、すぐに次のループを開始する
        console.log(`TTS完了後、即座に次の画像への遷移シーケンスを起動します。`);
        setTimeout(startScreensaverLoop, 0);

    } catch (error) {
        console.error("NASA APIエラー:", error);

        ELEMENTS.title.textContent = "接続エラー: HALの判断";
        ELEMENTS.date.textContent = "再接続を試みます...";
        ELEMENTS.explanation.textContent = `エラー詳細: ${error.message}`;
        ELEMENTS.overlay.classList.add('info-card--visible');

        setTimeout(startScreensaverLoop, 5000);
    }
}


const img = document.getElementById('nasa-image');

img.addEventListener('contextmenu', function (e) {
    // デフォルトのコンテキストメニューの表示をキャンセル
    e.preventDefault();
    // 必要に応じて、ユーザーにメッセージを表示するなど
    // alert('この画像の保存はできません。');
});

// ----------------------------------------------------
// III. 初期化と実行
// ----------------------------------------------------

/**
 * [関数] スクリーンセーバーを初期化し、ユーザーのクリックを待つ。
 */
function initializeScreensaver() {
    // DOM要素の参照を更新 (index.htmlに start-screen と start-button があることを前提)
    ELEMENTS.startScreen = document.getElementById('start-screen');
    ELEMENTS.startButton = document.getElementById('start-button');

    if (ELEMENTS.startScreen && ELEMENTS.startButton) {
        // ユーザー操作 (クリック) でTTS許可を得て、メインループを開始
        ELEMENTS.startButton.addEventListener('click', async () => {
            ELEMENTS.startScreen.style.display = 'none';
            // 最初の短い読み上げでブラウザのTTSを有効化させる
            await speakText("System activated. Processing astronomical data.");
            // 2秒間の待機を追加
            await sleep(600);
            startScreensaverLoop();
        }, { once: true });
    } else {
        // TTS初期化画面がない場合は、警告を出して自動で開始
        console.warn("TTS初期化画面のHTML要素が見つかりません。自動で開始しますが、読み上げがブロックされる可能性があります。");
        startScreensaverLoop();
    }
}
// ページが完全にロードされたら、初期化関数を実行
// document.addEventListener('DOMContentLoaded', ...) は、HTML要素の読み込みが完了した時点を待つ構文
document.addEventListener('DOMContentLoaded', initializeScreensaver);
