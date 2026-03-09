// worker.js
importScripts('https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.all.min.js');

self.onmessage = async (e) => {
  const { floatArray, sampleRate, type, gasUrl } = e.data;

  try {
    // 1. Float32Array から Int16Array への変換（MP3エンコード用）
    const samples = new Int16Array(floatArray.length);
    for (let i = 0; i < floatArray.length; i++) {
      samples[i] = floatArray[i] < 0 ? floatArray[i] * 0x8000 : floatArray[i] * 0x7FFF;
    }

    // 2. lamejs によるエンコード
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

    // 3. Base64変換（FileReaderSyncを使用）
    const reader = new FileReaderSync();
    const base64Data = reader.readAsDataURL(mp3Blob).split(',')[1];

    // 4. GASへ送信
    const targetUrl = `${gasUrl}?type=${type}`;
    // worker.js の fetch 部分を修正
    const response = await fetch(targetUrl, {
      method: "POST",
      mode: "cors", // 明示的に指定
      body: base64Data
    });

    const result = await response.json();
    self.postMessage({ status: 'success', result, type });

  } catch (err) {
    self.postMessage({ status: 'error', error: err.toString() });
  }
};
