// worker.js
importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js');

self.onmessage = async (e) => {
    const { audioData, isFinal, type, gasUrl } = e.data;
    
    try {
        // 1. WebM(Blob)をMP3に変換
        const mp3Blob = await encodeAsMp3(audioData);
        
        // 2. Base64に変換
        const reader = new FileReaderSync(); // Worker内では同期版が使えます
        const base64Data = reader.readAsDataURL(mp3Blob).split(',')[1];
        
        // 3. GASへ送信
        const targetUrl = `${gasUrl}?type=${type}`;
        const response = await fetch(targetUrl, {
            method: "POST",
            body: base64Data
        });
        
        const result = await response.json();
        
        // 4. メインスレッドへ結果を報告
        self.postMessage({ status: 'success', result, isFinal });
        
    } catch (err) {
        self.postMessage({ status: 'error', error: err.toString() });
    }
};

// worker.js 内の encodeAsMp3 を修正
function encodeAsMp3(arrayBuffer, sampleRate) {
    const floatSamples = new Float32Array(arrayBuffer);
    const samples = new Int16Array(floatSamples.length);
    
    // Float(-1.0〜1.0) を Int16(-32768〜32767) に変換
    for (let i = 0; i < floatSamples.length; i++) {
        samples[i] = floatSamples[i] < 0 ? floatSamples[i] * 0x8000 : floatSamples[i] * 0x7FFF;
    }

    const mp3enc = new lamejs.Mp3Encoder(1, sampleRate, 128);
    const mp3Data = [];
    const sampleBlockSize = 1152;
    
    for (let i = 0; i < samples.length; i += sampleBlockSize) {
        const sampleChunk = samples.subarray(i, i + sampleBlockSize);
        const mp3buf = mp3enc.encodeBuffer(sampleChunk);
        if (mp3buf.length > 0) mp3Data.push(new Int8Array(mp3buf));
    }
    const dmp3buf = mp3enc.flush();
    if (dmp3buf.length > 0) mp3Data.push(new Int8Array(dmp3buf));
    
    return new Blob(mp3Data, { type: 'audio/mp3' });
}
