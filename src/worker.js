const enc = new TextEncoder(), dec = new TextDecoder();
const b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const err = (m, s = 400) => json({ error: m }, s);
const rid = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => 'abcdefghjkmnpqrstuvwxyz23456789'[x % 31]).join('');

async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64u(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, k, 256));
}
const hkey = env => crypto.subtle.importKey('raw', enc.encode(env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
async function sign(env, p) {
  const body = b64u(enc.encode(JSON.stringify(p)));
  return body + '.' + b64u(await crypto.subtle.sign('HMAC', await hkey(env), enc.encode(body)));
}
async function verify(env, t) {
  const [b, s] = (t || '').split('.');
  if (!s) return null;
  try {
    if (!await crypto.subtle.verify('HMAC', await hkey(env), unb64u(s), enc.encode(b))) return null;
    const p = JSON.parse(dec.decode(unb64u(b)));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function cleanQuestions(qs) {
  if (!Array.isArray(qs) || !qs.length || qs.length > 200) return null;
  const T = (x, n) => String(x ?? '').slice(0, n), out = [];
  for (const q of qs) {
    if (!T(q.q, 2000).trim()) continue;
    const base = { q: T(q.q, 2000), e: T(q.e, 1000) };
    if (q.type === 'tf') {
      const s = (q.s || []).slice(0, 4).map(x => ({ t: T(x.t, 500), a: !!x.a })).filter(x => x.t.trim());
      if (s.length < 2) continue;
      out.push({ type: 'tf', ...base, s });
    } else {
      const o = (q.o || []).slice(0, 4).map(x => T(x, 500));
      if (o.filter(x => x.trim()).length < 2) continue;
      out.push({ type: 'mc', ...base, o, a: Math.min(3, Math.max(0, q.a | 0)) });
    }
  }
  return out.length ? out : null;
}
// Câu Đúng/Sai (4 ý): đúng 1 ý = 0,1đ; 2 ý = 0,25đ; 3 ý = 0,5đ; 4 ý = 1đ (thang của mỗi câu là 1)
const TFP = [0, 0.1, 0.25, 0.5, 1];
function grade(qs, ans) {
  let sum = 0, full = 0;
  const review = qs.map((q, i) => {
    const a = ans[i];
    let pts, r;
    if (q.type === 'tf') {
      const n = Array.isArray(a) ? q.s.filter((s, k) => a[k] === s.a).length : 0;
      pts = q.s.length === 4 ? TFP[n] : n / q.s.length;
      r = { s: q.s.map(s => s.a) };
    } else { pts = a === q.a ? 1 : 0; r = { a: q.a }; }
    sum += pts; if (pts === 1) full++;
    return { ...r, e: q.e, pts };
  });
  return { score: +(sum / qs.length * 10).toFixed(2), correct: full, review };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), path = url.pathname.replace(/^\/api/, ''), m = req.method, DB = env.DB;
    let body = {};
    if (m !== 'GET' && m !== 'DELETE') { try { body = await req.json(); } catch { return err('JSON không hợp lệ'); } }

    // ---- Auth ----
    if (path === '/register' && m === 'POST') {
      const email = String(body.email || '').trim().toLowerCase(), pw = String(body.password || '');
      if (!/^\S+@\S+\.\S+$/.test(email) || pw.length < 6) return err('Email không hợp lệ hoặc mật khẩu < 6 ký tự');
      const salt = crypto.getRandomValues(new Uint8Array(16));
      try {
        const r = await DB.prepare('INSERT INTO teachers(email,salt,pass) VALUES(?,?,?)').bind(email, b64u(salt), await hashPw(pw, salt)).run();
        return json({ token: await sign(env, { id: r.meta.last_row_id, exp: Date.now() + 30 * 864e5 }) });
      } catch { return err('Email đã được đăng ký', 409); }
    }
    if (path === '/login' && m === 'POST') {
      const u = await DB.prepare('SELECT * FROM teachers WHERE email=?').bind(String(body.email || '').trim().toLowerCase()).first();
      if (!u || await hashPw(String(body.password || ''), unb64u(u.salt)) !== u.pass) return err('Sai email hoặc mật khẩu', 401);
      return json({ token: await sign(env, { id: u.id, exp: Date.now() + 30 * 864e5 }) });
    }

    // ---- Học sinh (công khai) ----
    let r;
    if ((r = path.match(/^\/public\/(\w+)$/)) && m === 'GET') {
      const e = await DB.prepare('SELECT title,minutes,shuffle,data FROM exams WHERE code=?').bind(r[1]).first();
      if (!e) return err('Không tìm thấy đề', 404);
      const qs = JSON.parse(e.data).map(q => q.type === 'tf' ? { type: 'tf', q: q.q, s: q.s.map(s => s.t) } : { type: 'mc', q: q.q, o: q.o });
      return json({ title: e.title, minutes: e.minutes, shuffle: !!e.shuffle, questions: qs });
    }
    if ((r = path.match(/^\/public\/(\w+)\/submit$/)) && m === 'POST') {
      const e = await DB.prepare('SELECT id,data FROM exams WHERE code=?').bind(r[1]).first();
      if (!e) return err('Không tìm thấy đề', 404);
      const name = String(body.name || '').trim().slice(0, 80);
      if (!name) return err('Vui lòng nhập họ tên');
      const qs = JSON.parse(e.data), ans = Array.isArray(body.answers) ? body.answers : [];
      const { score, correct, review } = grade(qs, ans);
      await DB.prepare('INSERT INTO submissions(exam_id,name,score,correct,total,answers,created) VALUES(?,?,?,?,?,?,?)')
        .bind(e.id, name, score, correct, qs.length, JSON.stringify(ans.slice(0, qs.length)), Date.now()).run();
      return json({ score, correct, total: qs.length, review });
    }

    // ---- Giáo viên (cần đăng nhập) ----
    const me = await verify(env, (req.headers.get('authorization') || '').slice(7));
    if (!me) return err('Chưa đăng nhập', 401);

    if (path === '/exams' && m === 'GET') {
      const { results } = await DB.prepare('SELECT e.id,e.code,e.title,e.minutes,(SELECT COUNT(*) FROM submissions s WHERE s.exam_id=e.id) AS subs FROM exams e WHERE teacher_id=? ORDER BY created DESC').bind(me.id).all();
      return json(results);
    }
    if (path === '/exams' && m === 'POST') {
      const qs = cleanQuestions(body.questions), title = String(body.title || '').trim().slice(0, 200);
      if (!qs || !title) return err('Đề cần tên và ít nhất 1 câu hợp lệ');
      const id = rid(10), code = rid(6);
      await DB.prepare('INSERT INTO exams(id,code,teacher_id,title,minutes,shuffle,data,created) VALUES(?,?,?,?,?,?,?,?)')
        .bind(id, code, me.id, title, Math.min(300, Math.max(1, body.minutes | 0 || 15)), body.shuffle ? 1 : 0, JSON.stringify(qs), Date.now()).run();
      return json({ id, code });
    }
    if ((r = path.match(/^\/exams\/(\w+)$/))) {
      const e = await DB.prepare('SELECT * FROM exams WHERE id=? AND teacher_id=?').bind(r[1], me.id).first();
      if (!e) return err('Không tìm thấy đề', 404);
      if (m === 'GET') return json({ id: e.id, code: e.code, title: e.title, minutes: e.minutes, shuffle: !!e.shuffle, questions: JSON.parse(e.data) });
      if (m === 'DELETE') {
        await DB.batch([DB.prepare('DELETE FROM submissions WHERE exam_id=?').bind(e.id), DB.prepare('DELETE FROM exams WHERE id=?').bind(e.id)]);
        return json({ ok: 1 });
      }
      if (m === 'PUT') {
        const qs = cleanQuestions(body.questions), title = String(body.title || '').trim().slice(0, 200);
        if (!qs || !title) return err('Đề cần tên và ít nhất 1 câu hợp lệ');
        await DB.prepare('UPDATE exams SET title=?,minutes=?,shuffle=?,data=? WHERE id=?')
          .bind(title, Math.min(300, Math.max(1, body.minutes | 0 || 15)), body.shuffle ? 1 : 0, JSON.stringify(qs), e.id).run();
        return json({ ok: 1 });
      }
    }
    if ((r = path.match(/^\/exams\/(\w+)\/results$/)) && m === 'GET') {
      const e = await DB.prepare('SELECT id,title FROM exams WHERE id=? AND teacher_id=?').bind(r[1], me.id).first();
      if (!e) return err('Không tìm thấy đề', 404);
      const { results } = await DB.prepare('SELECT name,score,correct,total,created FROM submissions WHERE exam_id=? ORDER BY created DESC').bind(e.id).all();
      return json({ title: e.title, results });
    }
    return err('Not found', 404);
  }
};
