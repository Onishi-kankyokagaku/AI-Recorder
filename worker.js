importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js');

self.onmessage = async (e) => {
    const { type, gasUrl, ssId, index, logRow, floatArray, sampleRate } = e.data;

    // --- [Step 1: SS発行（初期化）] ---
    if (type === 'init') {
        try {
            const response = await fetch(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ type: 'init' })
            });
            const result = await response.json();
            self.postMessage({ status: 'success', type: 'init', result: result });
        } catch (error) {
            self.postMessage({ status: 'error', type: 'init', error: error.message });
        }
        return; 
    }

    // --- [録音開始の通知] ---
    if (type === 'recording') {
        try {
            fetch(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ type: 'recording', logRow: logRow })
            });
        } catch (error) {
            console.error("Recording status update error:", error);
        }
        return;
    }
    
    // --- [通常録音の送信] ---
    if (!floatArray) {
        self.postMessage({ status: 'error', type: type, error: "音声データが空です" });
        return;
    }

    // 1. MP3変換を実行（同期処理として計算）
    const mp3Data = encodeMP3(floatArray, sampleRate);
    
    // 2. Base64変換（FileReaderを使わず、以前の確実な手法に合わせる）
    const base64Audio = arrayBufferToBase64(mp3Data);

    try {
        const response = await fetch(gasUrl, {
            method: 'POST',
            body: JSON.stringify({
                type: type,
                index: index,
                ssId: ssId,
                logRow: logRow,
                audio: base64Audio
            })
        });
        const result = await response.json();
        
        // ここでしっかりメイン画面に「成功」を伝える
        self.postMessage({ 
            status: 'success', 
            type: type, 
            index: index,
            result: result 
        });
    } catch (error) {
        // final時のタイムアウト対策
        if (type === 'final') {
            self.postMessage({ 
                status: 'success', 
                type: 'final', 
                index: index, 
                result: { status: "timeout_but_proceed" } 
            });
        } else {
            self.postMessage({ status: 'error', type: type, error: error.message });
        }
    }
};

/**
 * MP3エンコード関数（ArrayBufferを返す）
 */
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

    // 複数のUint8Arrayを一つのUint8Arrayに結合して返す
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

/**
 * 以前のコードで実績のあるBase64変換関数
 */
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
