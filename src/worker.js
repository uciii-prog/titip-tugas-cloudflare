const HTML_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}
function clean(value, max = 100) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}
function makeCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}
async function encryptToken(token, secret) {
  const keyBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(token));
  const b64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  return `${b64(iv)}.${b64(ciphertext)}`;
}
async function decryptToken(payload, secret) {
  const [ivPart, dataPart] = payload.split(".");
  const keyBytes = Uint8Array.from(atob(secret), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(ivPart) }, key, unb64(dataPart));
  return new TextDecoder().decode(plaintext);
}
function oauthRedirectUri(env, url) {
  return env.GOOGLE_REDIRECT_URI || `${url.origin}/auth/callback`;
}
function googleAuthUrl(env, url, state) {
  const redirect = oauthRedirectUri(env, url);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: redirect,
    response_type: "code",
    scope: "openid email profile https://www.googleapis.com/auth/drive.file",
    access_type: "offline",
    prompt: "consent",
    state
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
async function googleToken(env, params) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      ...params
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || "Google token exchange failed");
  return data;
}
async function driveRequest(accessToken, url, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("authorization", `Bearer ${accessToken}`);
  return fetch(url, { ...init, headers });
}
async function getTeacherAccessToken(env, teacher) {
  const refreshToken = await decryptToken(teacher.refresh_token_enc, env.TOKEN_ENCRYPTION_KEY);
  const data = await googleToken(env, {
    refresh_token: refreshToken,
    grant_type: "refresh_token"
  });
  return data.access_token;
}
async function createDriveFolder(accessToken) {
  const response = await driveRequest(accessToken, "https://www.googleapis.com/drive/v3/files?fields=id,name", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: "Titip Tugas - Pengumpulan Siswa",
      mimeType: "application/vnd.google-apps.folder"
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Tidak bisa membuat folder Drive");
  return data.id;
}
async function googleProfile(accessToken) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json();
  if (!response.ok || !data.email) throw new Error("Tidak bisa membaca email akun Google");
  return data;
}
async function uploadToDrive(accessToken, folderId, file, filename, description) {
  const boundary = "titiptugas_" + crypto.randomUUID().replaceAll("-", "");
  const metadata = JSON.stringify({
    name: filename,
    parents: [folderId],
    description
  });
  const prefix = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`;
  const suffix = `\r\n--${boundary}--`;
  const body = new Blob([prefix, file, suffix]);
  const response = await driveRequest(accessToken, "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name", {
    method: "POST",
    headers: { "content-type": `multipart/related; boundary=${boundary}` },
    body
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Unggahan ke Google Drive gagal");
  return data;
}
function htmlPage(title, message, kind = "success") {
  const safeTitle = String(title).replace(/[&<>"]/g, "");
  const safeMessage = String(message).replace(/[&<>"]/g, "");
  return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle} — Titip Tugas</title><link rel="stylesheet" href="/style.css"></head><body><main class="shell"><header class="brand"><div class="brand-mark">TT</div><div><strong>Titip Tugas</strong><span>Pengumpulan tugas via satu QR</span></div></header><section class="panel ${kind}"><h1>${safeTitle}</h1><p>${safeMessage}</p><a class="button" href="/">Kembali ke beranda</a></section><footer>Portal pengumpulan tugas</footer></main></body></html>`, { headers: HTML_HEADERS });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === "GET" && path === "/health") return json({ ok: true });

    if (request.method === "GET" && path === "/teacher/connect") {
      if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEY) {
        return htmlPage("Konfigurasi belum lengkap", "Pengelola portal perlu menyiapkan kredensial Google OAuth dan kunci enkripsi terlebih dahulu.", "error");
      }
      const state = crypto.randomUUID() + crypto.randomUUID();
      await env.DB.prepare("INSERT INTO oauth_states (state, created_at) VALUES (?, ?)").bind(state, Date.now()).run();
      return Response.redirect(googleAuthUrl(env, url, state), 302);
    }

    if (request.method === "GET" && path === "/auth/callback") {
      try {
        const state = url.searchParams.get("state") || "";
        const saved = await env.DB.prepare("SELECT state, created_at FROM oauth_states WHERE state = ?").bind(state).first();
        await env.DB.prepare("DELETE FROM oauth_states WHERE created_at < ?").bind(Date.now() - 15 * 60 * 1000).run();
        if (!saved || Date.now() - saved.created_at > 15 * 60 * 1000) return htmlPage("Sesi kedaluwarsa", "Silakan kembali dan hubungkan Google Drive lagi.", "error");
        await env.DB.prepare("DELETE FROM oauth_states WHERE state = ?").bind(state).run();
        if (url.searchParams.get("error")) return htmlPage("Koneksi dibatalkan", "Google Drive belum dihubungkan. Silakan coba lagi.", "error");
        const codeParam = url.searchParams.get("code");
        if (!codeParam) return htmlPage("Koneksi gagal", "Kode otorisasi Google tidak ditemukan.", "error");

        const tokens = await googleToken(env, {
          code: codeParam,
          grant_type: "authorization_code",
          redirect_uri: oauthRedirectUri(env, url)
        });
        if (!tokens.refresh_token) return htmlPage("Izin Google belum lengkap", "Google tidak memberikan refresh token. Cabut akses aplikasi dari akun Google lalu hubungkan ulang.", "error");
        const profile = await googleProfile(tokens.access_token);
        const folderId = await createDriveFolder(tokens.access_token);
        let existing = await env.DB.prepare("SELECT code FROM teachers WHERE email = ?").bind(profile.email).first();
        let code;
        if (existing) {
          code = existing.code;
          await env.DB.prepare("UPDATE teachers SET refresh_token_enc = ?, folder_id = ? WHERE email = ?")
            .bind(await encryptToken(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY), folderId, profile.email).run();
        } else {
          do {
            code = makeCode();
            existing = await env.DB.prepare("SELECT code FROM teachers WHERE code = ?").bind(code).first();
          } while (existing);
          await env.DB.prepare("INSERT INTO teachers (email, code, refresh_token_enc, folder_id) VALUES (?, ?, ?, ?)")
            .bind(profile.email, code, await encryptToken(tokens.refresh_token, env.TOKEN_ENCRYPTION_KEY), folderId).run();
        }
        return new Response(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kode guru siap</title><link rel="stylesheet" href="/style.css"></head><body><main class="shell"><header class="brand"><div class="brand-mark">TT</div><div><strong>Titip Tugas</strong><span>Pengumpulan tugas via satu QR</span></div></header><section class="panel success"><div class="eyebrow">AKUN GURU TERHUBUNG</div><h1>Kode guru sudah siap!</h1><p>Drive terhubung untuk <strong>${profile.email.replace(/[&<>"]/g,"")}</strong>.</p><div class="code-box"><span>KODE GURU</span><strong>${code}</strong></div><p>Bagikan kode ini ke siswa. Semua siswa tetap memakai QR yang sama, lalu memasukkan kode ini saat mengumpulkan tugas.</p><p class="note">Folder <strong>Titip Tugas - Pengumpulan Siswa</strong> dibuat di Google Drive akun ini.</p><a class="button" href="/">Kembali ke halaman siswa</a></section><footer>Simpan kode guru dengan aman.</footer></main></body></html>`, { headers: HTML_HEADERS });
      } catch (err) {
        console.error("OAuth callback failed", err.message);
        return htmlPage("Koneksi belum berhasil", "Periksa konfigurasi OAuth Google, izin Drive API, dan URL callback lalu coba lagi.", "error");
      }
    }

    if (request.method === "GET" && path.startsWith("/api/teacher/")) {
      const code = clean(decodeURIComponent(path.slice("/api/teacher/".length)), 12).toUpperCase();
      const teacher = await env.DB.prepare("SELECT email FROM teachers WHERE code = ?").bind(code).first();
      if (!teacher) return json({ ok: false, message: "Kode guru tidak ditemukan. Periksa kembali kode yang dimasukkan." }, 404);
      return json({ ok: true, teacher: teacher.email });
    }

    if (request.method === "POST" && path === "/api/submit") {
      try {
        const form = await request.formData();
        const code = clean(form.get("teacherCode"), 12).toUpperCase();
        const studentName = clean(form.get("studentName"), 100);
        const className = clean(form.get("className"), 80);
        const file = form.get("answer");
        if (!code || !studentName || !className || !(file instanceof File) || !file.size) {
          return json({ ok: false, message: "Lengkapi kode guru, nama, kelas, dan pilih file." }, 400);
        }
        if (file.size > 15 * 1024 * 1024) return json({ ok: false, message: "Ukuran file maksimal 15 MB." }, 413);
        const allowed = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);
        if (!allowed.has(file.type)) return json({ ok: false, message: "Format file harus PDF, JPG, PNG, atau WEBP." }, 400);
        const teacher = await env.DB.prepare("SELECT * FROM teachers WHERE code = ?").bind(code).first();
        if (!teacher) return json({ ok: false, message: "Kode guru tidak ditemukan." }, 404);

        const accessToken = await getTeacherAccessToken(env, teacher);
        const original = file.name.replace(/[\/\\\u0000-\u001f]/g, "_").slice(0, 100) || "jawaban";
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const filename = `${timestamp}_${studentName}_${className}_${original}`.replace(/[\/\\]/g, "_");
        const uploaded = await uploadToDrive(
          accessToken, teacher.folder_id, file, filename,
          `Tugas siswa: ${studentName}; kelas: ${className}; kode guru: ${code}`
        );
        await env.DB.prepare("INSERT INTO submissions (teacher_id, student_name, class_name, original_filename, drive_file_id) VALUES (?, ?, ?, ?, ?)")
          .bind(teacher.id, studentName, className, original, uploaded.id).run();
        return json({ ok: true, message: "Tugas berhasil dikirim ke Google Drive guru." });
      } catch (err) {
        console.error("Upload failed", err.message);
        return json({ ok: false, message: "Tugas belum berhasil dikirim. Periksa koneksi Drive guru atau coba lagi." }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
