importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js');

self.onmessage = async (e) => {
    // ssId を受け取れるように展開
    const { floatArray, sampleRate, type, gasUrl, ssId } = e.data;

    try {
        // --- 音声エンコード処理 (変更なし) ---
        const samples = new Int16Array(floatArray.length);
        for (let i = 0; i < floatArray.length; i++) {
            samples[i] = floatArray[i] < 0 ? floatArray[i] * 0x8000 : floatArray[i] * 0x7FFF;
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

        const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
        const reader = new FileReaderSync();
        const base64Data = reader.readAsDataURL(mp3Blob).split(',')[1];

        // --- GASへの送信処理 (ssIdを追加) ---
        // ssIdがある場合はURLパラメータに付与する
        let targetUrl = `${gasUrl}?type=${type}`;
        if (ssId) {
            targetUrl += `&ssId=${encodeURIComponent(ssId)}`;
        }

        const response = await fetch(targetUrl, {
            method: "POST",
            body: base64Data,
            redirect: "follow"
        });
        
        if (!response.ok) throw new Error("GAS HTTP Error: " + response.status);
        
        const result = await response.json();
        
        // メインスレッドに結果を返す（ここで返ってきたssIdをメイン側が記憶する）
        self.postMessage({ status: 'success', result, type });

    } catch (err) {
        self.postMessage({ status: 'error', error: err.message, type });
    }
};
