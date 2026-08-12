importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js');

// --- IndexedDB ヘルパー (Worker内) ---
const DB_NAME = 'AIRecorderDB';
const STORE_NAME = 'audioQueue';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'index' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

async function saveToLocal(item) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function deleteFromLocal(index) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(index);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

// --- リトライ機能付き fetch ---
async function fetchWithRetry(url, options, maxRetries = 6, initialDelay = 5000) {
    let delay = initialDelay;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) {
                const json = await response.json();
                return json;
            }
            throw new Error(`HTTP Error: ${response.status}`);
        } catch (err) {
            if (attempt === maxRetries) throw err;
            // メイン側にリトライ状態を通知
            self.postMessage({ status: 'retrying', attempt: attempt, maxRetries: maxRetries, error: err.message });
            await new Promise(r => setTimeout(r, delay));
            delay *= 2; // 指数バックオフ
        }
    }
}

// メッセージ受信用
self.onmessage = async (e) => {
    const { type, gasUrl, ssId, index, logRow, floatArray, sampleRate } = e.data;

    // --- [Step 1: SS発行（初期化）] ---
    if (type === 'init') {
        try {
            const result = await fetchWithRetry(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ type: 'init' })
            }, 3, 2000);
            self.postMessage({ status: 'success', type: 'init', result: result });
        } catch (error) {
            self.postMessage({ status: 'error', type: 'init', error: error.message });
        }
        return; 
    }

    // --- [録音開始の通知] ---
    if (type === 'recording') {
        try {
            await fetchWithRetry(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ type: 'recording', logRow: logRow })
            }, 3, 2000);
            self.postMessage({ status: 'success', type: 'recording' });
        } catch (error) {
            console.error("Recording status update error:", error);
            self.postMessage({ status: 'error', type: 'recording', error: error.message });
        }
        return;
    }

    // --- [通常録音・最終録音の送信] ---
    if (!floatArray) {
        self.postMessage({ status: 'error', type: type, index: index, error: "音声データが空です" });
        return;
    }

    const mp3Data = encodeMP3(floatArray, sampleRate);
    const base64Audio = arrayBufferToBase64(mp3Data);

    const payload = {
        type: type,
        index: index,
        ssId: ssId,
        logRow: logRow,
        audio: base64Audio
    };

    // 1. IndexedDB に一次保存
    try {
        await saveToLocal(payload);
    } catch (dbErr) {
        console.warn("IndexedDBへの保存に失敗しました:", dbErr);
    }

    // 2. GASへ送信（自動リトライ付き）
    try {
        const result = await fetchWithRetry(gasUrl, {
            method: 'POST',
            body: JSON.stringify(payload)
        }, 6, 5000);

        // 送信成功したら IndexedDB から削除
        await deleteFromLocal(index);

        self.postMessage({ 
            status: 'success', 
            type: type, 
            index: index,
            result: result 
        });
    } catch (error) {
        // リトライオーバー時：ローカルには保存されているため失敗を返して次に備える
        self.postMessage({ 
            status: 'warning_offline', 
            type: type, 
            index: index, 
            error: "通信障害のため一時保存されました。後ほど自動再送されます。" 
        });
    }
};

function encodeMP3(samples, sampleRate) {
    const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, 128);
    const mp3Data = [];
    const int16Samples = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        let s = Math.max(-1, Math.min(1, samples[i]));
        int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    const mp3Tmp = mp3encoder.encodeBuffer(int16Samples);
    if (mp3Tmp.length > 0) mp3Data.push(mp3Tmp);
    const mp3Exit = mp3encoder.flush();
    if (mp3Exit.length > 0) mp3Data.push(mp3Exit);
    let totalLength = 0;
    for (const buf of mp3Data) totalLength += buf.length;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of mp3Data) {
        result.set(buf, offset);
        offset += buf.length;
    }
    return result.buffer;
}

function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
