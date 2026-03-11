importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js');

// worker.js
self.onmessage = async (e) => {
    const { floatArray, sampleRate, type, index, gasUrl, ssId } = e.data;

    // initの場合は音声処理をスキップ
    if (type === 'init') {
        const response = await fetch(gasUrl, {
            method: 'POST',
            body: JSON.stringify({ type: 'init' })
        });
        const result = await response.json();
        self.postMessage({ status: 'success', type: 'init', result: result });
        return;
    }

    // 音声変換（WAV化）ロジックはそのまま
    const wavBuffer = encodeWAV(floatArray, sampleRate);
    const base64Audio = arrayBufferToBase64(wavBuffer);

    try {
        const response = await fetch(gasUrl, {
            method: 'POST',
            body: JSON.stringify({
                type: type,
                index: index, // ★GASへ連番を送る
                ssId: ssId,
                audio: base64Audio
            })
        });
        const result = await response.json();
        self.postMessage({ 
            status: 'success', 
            type: type, 
            index: index, // ★結果と一緒にindexを返す
            result: result 
        });
    } catch (error) {
        self.postMessage({ status: 'error', type: type, error: error.message });
    }
};

// (encodeWAV, arrayBufferToBase64 関数は既存のまま)
