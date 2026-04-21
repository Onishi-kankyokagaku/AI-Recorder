importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js');

self.onmessage = async (e) => {
    // ★ 修正ポイント1: logRow を受け取り項目に追加
    const { type, gasUrl, ssId, index, logRow } = e.data;

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

    // ★ 録音開始ボタンが押された時の通知処理
    if (type === 'recording') {
        try {
            fetch(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ 
                    type: 'recording', 
                    logRow: logRow 
                })
            });
        } catch (error) {
            console.error("Recording status update error:", error);
        }
        return; 
    }
    
    // --- [通常録音の送信] ---
    const { floatArray, sampleRate } = e.data;
    
    if (!floatArray) {
        self.postMessage({ status: 'error', type: type, error: "音声データが空です" });
        return;
    }

    // ★ 修正ポイント：WAVではなく、本物のMP3に変換を実行
    const mp3Blob = encodeMP3(floatArray, sampleRate);
    
    // BlobをBase64に変換して送信
    const reader = new FileReader();
    reader.readAsDataURL(mp3Blob);
    reader.onloadend = async () => {
        const base64Audio = reader.result.split(',')[1];

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
            self.postMessage({ 
                status: 'success', 
                type: type, 
                index: index,
                result: result 
            });
        } catch (error) {
            // final送信時のFetchエラー（タイムアウト）対策
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
};

/**
 * ★ 新規：lamejsを使用したMP3変換関数
 */
function encodeMP3(samples, sampleRate) {
    const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, 128); // モノラル, 128kbps
    const mp3Data = [];

    // Float32Array (-1.0 ~ 1.0) を Int16Array (-32768 ~ 32767) に変換
    const int16Samples = new Int16Array(samples.length);
    for (let i = 0; i < samples.length; i++) {
        let s = Math.max(-1, Math.min(1, samples[i]));
        int16Samples[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // MP3エンコード
    const mp3Tmp = mp3encoder.encodeBuffer(int16Samples);
    if (mp3Tmp.length > 0) {
        mp3Data.push(mp3Tmp);
    }

    // 終了処理
    const mp3Exit = mp3encoder.flush();
    if (mp3Exit.length > 0) {
        mp3Data.push(mp3Exit);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
}
