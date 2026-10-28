// js/music.js — Trình phát MP3 tự chứa (không sửa index.html)
// Đọc manifest assets/music/manifest.json, phát các track, đọc ID3v2 metadata.

// ID3v2 parser (title/artist) — pure, testable
export function parseID3(buffer) {
    if (!buffer || buffer.byteLength < 10) return null;
    const view = new DataView(buffer);
    if (view.getUint8(0) !== 0x49 || view.getUint8(1) !== 0x44 || view.getUint8(2) !== 0x33) return null;
    const size = (view.getUint8(6) << 21) | (view.getUint8(7) << 14) | (view.getUint8(8) << 7) | view.getUint8(9);
    let off = 10;
    const end = Math.min(10 + size, view.byteLength);
    const out = { title: null, artist: null };
    while (off + 10 < end) {
        const id = String.fromCharCode(view.getUint8(off), view.getUint8(off+1), view.getUint8(off+2), view.getUint8(off+3));
        const frameSize = view.getUint32(off + 4);
        if (frameSize === 0 || off + 10 + frameSize > end) break;
        if (id === 'TIT2' || id === 'TPE1') {
            const enc = view.getUint8(off + 10);
            let str = '';
            if (enc === 0 || enc === 3) {
                const bytes = new Uint8Array(buffer, off + 11, frameSize - 1);
                str = new TextDecoder(enc === 3 ? 'utf-8' : 'latin1').decode(bytes).replace(/\0/g, '');
            } else if (enc === 1 || enc === 2) {
                const bytes = new Uint8Array(buffer, off + 11, frameSize - 1);
                str = new TextDecoder(enc === 1 ? 'utf-16' : 'utf-16be').decode(bytes).replace(/\0/g, '');
            }
            if (id === 'TIT2') out.title = str;
            else out.artist = str;
        }
        off += 10 + frameSize;
    }
    return out;
}

export function createMusicPlayer({ volume = 0.6 } = {}) {
    const MANIFEST_URL = 'assets/music/manifest.json';
    let audio = null;
    let tracks = [];
    let index = 0;
    let loop = false;
    let playing = false;

    const root = document.createElement('div');
    root.id = 'music-player';
    root.style.cssText = 'position:fixed;bottom:16px;right:200px;z-index:100;background:linear-gradient(135deg,rgba(2,6,23,.9),rgba(15,23,42,.95));border:1px solid rgba(59,130,246,.3);border-radius:10px;padding:8px 12px;display:flex;align-items:center;gap:8px;backdrop-filter:blur(4px);box-shadow:0 4px 16px rgba(0,0,0,.4);max-width:320px;';
    const title = document.createElement('span');
    title.style.cssText = 'color:#94a3b8;font-size:.8rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    title.textContent = 'Chưa có nhạc';
    const btnPlay = document.createElement('button');
    const btnNext = document.createElement('button');
    const btnPrev = document.createElement('button');
    const btnLoop = document.createElement('button');
    const btnAdd = document.createElement('button');
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'audio/mpeg, audio/mp3';
    fileInput.multiple = true;
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    for (const b of [btnPlay, btnPrev, btnNext, btnLoop, btnAdd]) {
        b.style.cssText = 'background:rgba(59,130,246,.15);color:#e2e8f0;border:1px solid rgba(59,130,246,.3);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:.85rem;';
    }
    btnPlay.textContent = '▶';
    btnPrev.textContent = '⏮';
    btnNext.textContent = '⏭';
    btnLoop.textContent = '🔁';
    btnAdd.textContent = '📁';
    btnAdd.title = 'Thêm file MP3';
    root.append(title, btnPrev, btnPlay, btnNext, btnLoop, btnAdd, fileInput);
    document.body.appendChild(root);

    audio = new Audio();
    audio.volume = volume;
    audio.addEventListener('ended', () => {
        if (loop) { audio.currentTime = 0; audio.play().catch(() => {}); }
        else next();
    });
    audio.addEventListener('error', () => {
        title.textContent = `Lỗi phát: ${trackName(tracks[index] || {})}`;
        console.warn("[music] Loi phat track:", tracks[index]?.file, audio.error?.message || "");
    });

    function trackName(t) {
        if (t.title) return t.title + (t.artist ? ' — ' + t.artist : '');
        const f = t.file || '';
        return f.split('/').pop().replace(/\.mp3$/i, '') || 'Track';
    }

    async function loadManifest() {
        try {
            const r = await fetch(MANIFEST_URL);
            if (!r.ok) throw new Error(`manifest request failed (${r.status})`);
            const data = await r.json();
            if (!Array.isArray(data.tracks)) throw new Error('manifest must contain a tracks array');
            tracks = data.tracks.filter(t => t && typeof t.file === 'string' && t.file.length > 0);
        } catch (e) {
            tracks = [];
            console.error("[music] Khong tai duoc danh sach nhac:", e);
            title.textContent = 'Không thể tải danh sách nhạc';
            return 0;
        }
        updateTitle();
        return tracks.length;
    }

    async function addLocalFiles(files) {
        for (const file of files) {
            if (file.type !== 'audio/mpeg' && !file.name.toLowerCase().endsWith('.mp3')) continue;
            let metadata = null;
            try {
                metadata = parseID3(await file.slice(0, 65536).arrayBuffer());
            } catch (e) {
                console.warn("[music] Khong doc duoc ID3:", file.name, e);
            }
            tracks.push({
                file: URL.createObjectURL(file),
                title: metadata?.title || file.name.replace(/\.mp3$/i, ''),
                artist: metadata?.artist || null,
                isLocal: true
            });
        }
        if (tracks.length > 0 && index >= tracks.length) index = 0;
        updateTitle();
    }

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            void addLocalFiles(Array.from(e.target.files));
        }
        e.target.value = '';
    });

    btnAdd.addEventListener('click', () => fileInput.click());

    // Drag & drop
    root.addEventListener('dragover', (e) => {
        e.preventDefault();
        root.style.borderColor = '#3b82f6';
    });
    root.addEventListener('dragleave', () => {
        root.style.borderColor = 'rgba(59,130,246,.3)';
    });
    root.addEventListener('drop', (e) => {
        e.preventDefault();
        root.style.borderColor = 'rgba(59,130,246,.3)';
        if (e.dataTransfer.files.length > 0) {
            void addLocalFiles(Array.from(e.dataTransfer.files));
        }
    });

    function updateTitle() {
        if (tracks.length === 0) { title.textContent = 'Chưa có nhạc (kéo thả MP3 hoặc bấm 📁)'; return; }
        title.textContent = trackName(tracks[index]);
    }

    function play() {
        if (tracks.length === 0) return false;
        const t = tracks[index];
        if (audio.src !== new URL(t.file, location.href).href) audio.src = t.file;
        audio.play().then(() => {
            playing = true;
            btnPlay.textContent = '⏸';
        }).catch((e) => {
            playing = false;
            btnPlay.textContent = '▶';
            title.textContent = `Không phát được: ${trackName(t)}`;
            console.warn("[music] Khong phat duoc track:", t.file, e);
        });
        return true;
    }
    function pause() { audio.pause(); playing = false; btnPlay.textContent = '▶'; }
    function toggle() { playing ? pause() : play(); }
    function next() {
        if (tracks.length === 0) return;
        index = (index + 1) % tracks.length;
        updateTitle();
        if (playing) play();
    }
    function prev() {
        if (tracks.length === 0) return;
        index = (index - 1 + tracks.length) % tracks.length;
        updateTitle();
        if (playing) play();
    }
    function setLoop(v) { loop = !!v; btnLoop.style.opacity = loop ? '1' : '0.5'; }
    btnPlay.addEventListener('click', toggle);
    btnPrev.addEventListener('click', prev);
    btnNext.addEventListener('click', next);
    btnLoop.addEventListener('click', () => setLoop(!loop));
    setLoop(false);

    // ID3 ƯU TIÊN hơn tên trong manifest (manifest chỉ là phương án dự phòng
    // theo đúng yêu cầu). Bản cũ bỏ qua ID3 khi manifest đã có title ⇒ thực
    // chất luôn dùng tên tệp. Đọc 16KB đầu (Range) — đủ cho frame text,
    // không tải cả file.
    async function enrichTrack(t) {
        if (t.isLocal) return;
        try {
            const r = await fetch(t.file, { headers: { Range: 'bytes=0-16383' } });
            if (!r.ok) return;
            const buf = await r.arrayBuffer();
            const meta = parseID3(buf);
            if (meta) {
                if (meta.title) t.title = meta.title;
                if (meta.artist) t.artist = meta.artist;
            }
        } catch (e) { /* file lỗi/không có ID3 -> giữ tên manifest */ }
    }

    loadManifest().then(async () => {
        for (const t of tracks) await enrichTrack(t);
        updateTitle();
    });

    function setVolume(value) {
        audio.volume = Math.max(0, Math.min(1, Number(value) || 0));
    }

    return { play, pause, toggle, next, prev, setLoop, setVolume, loadManifest, parseID3, getTracks: () => tracks, getIndex: () => index };
}
