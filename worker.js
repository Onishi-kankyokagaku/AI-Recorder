importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js');

// ★【重要】最後に届いたindex（セグメント番号）をWorker内で保持します
let lastIndex = 0;

self.onmessage = async (e) => {
    // e.data から変数を取り出す
    const { type, gasUrl, ssId, index, logRow } = e.data;

    // ★indexが届いていれば常に更新（1, 2, 3...と増えていくのを記憶する）
    if (index !== undefined && index !== null) {
        lastIndex = index;
    }

    // --- [新規：ステータス確認] ---
    if (type === 'check_status') {
        try {
            const response = await fetch(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ type: 'check_status', logRow: logRow })
            });
            const result = await response.json();
            self.postMessage({ status: 'success', type: 'check_status', result: result });
        } catch (error) {
            self.postMessage({ status: 'error', type: 'check_status', error: error.message });
        }
        return;
    }

    // --- [新規：議事録作成の最終実行指示] ---
    if (type === 'finalize_request') {
        try {
            // ★ポイント：ここでの body.index には、Workerが記憶している lastIndex を入れます
            fetch(gasUrl, {
                method: 'POST',
                body: JSON.stringify({ 
                    type: 'execute_finalize', 
                    ssId: ssId, 
                    logRow: logRow, 
                    index: lastIndex 
                })
            });
            self.postMessage({ status: 'success', type: 'finalize_request' });
        } catch (error) {
            console.error("Finalize request error:", error);
        }
        return;
    }

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

    // --- [録音開始時の通知処理] ---
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
    
    // --- [通常録音の送信（memo / final）] ---
    const { floatArray, sampleRate } = e.data;
    if (!floatArray) {
        self.postMessage({ status: 'error', type: type, error: "音声データが空です" });
        return;
    }

    const wavBuffer = encodeWAV(floatArray, sampleRate);
    const base64Audio = arrayBufferToBase64(wavBuffer);

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
        self.postMessage({ status: 'error', type: type, error: error.message });
    }
};


function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };
    writeString(0, 'RIFF');
    view.setUint32(4, 32 + samples.length * 2, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return buffer;
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
