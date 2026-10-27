/**
 * LensLink 中继凭证服务（Cloudflare Workers）。
 *
 * 职责：用你自己的 Cloudflare Realtime TURN Key 现签短期 ICE 凭证，
 * 给 LensLink 两台设备换取 TURN 中继入口。凭证默认 1 小时过期，
 * App 每次建连前来换一次，所以不存在「抄在设置里第二天失效」的问题。
 *
 * 与 LensLink App 的接口契约（保持这两个端点的形状不变）：
 *   GET /health               → { status, version, turn: { enabled } }
 *   GET /v1/turn-credentials  → { enabled, iceServers: [{ urls, username, credential }], ttl }
 *
 * 只留两条主力链路，省流量也加快建连：
 *   turn:…:3478?transport=udp   —— UDP 3478，延迟最低
 *   turns:…:443?transport=tcp   —— TLS 443，给只放行 443 的网络兜底
 */

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "accept, content-type",
};

const KEEP = [
  /^turn:[^?]+:3478\?transport=udp$/,
  /^turns:[^?]+:443\?transport=tcp$/,
];

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...CORS, ...extra },
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }
    if (request.method !== "GET") {
      return json({ code: "METHOD_NOT_ALLOWED" }, 405);
    }

    // 健康检查：LensLink 设置页/中继保存前会探这里，看 turn.enabled 判断配没配好
    if (url.pathname === "/health") {
      return json({
        status: "ok",
        version: "1.0.0",
        turn: { enabled: hasKeys(env) },
      });
    }

    // 签发短期凭证
    if (url.pathname === "/v1/turn-credentials") {
      return issueCredentials(env);
    }

    return json({ code: "NOT_FOUND" }, 404);
  },
};

function hasKeys(env) {
  return !!(env.TURN_KEY_ID && env.TURN_KEY_TOKEN);
}

async function issueCredentials(env) {
  if (!hasKeys(env)) {
    return json({
      enabled: false,
      iceServers: [],
      message:
        "还没配置 TURN_KEY_ID / TURN_KEY_TOKEN：在 Worker 的 Settings → Variables and Secrets 里补上，或用 wrangler secret put 写入",
    });
  }

  const ttl = Math.max(300, parseInt(env.TURN_TTL || "3600", 10) || 3600);
  const res = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.TURN_KEY_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ttl }),
    },
  );
  if (!res.ok) {
    return json(
      { enabled: false, iceServers: [], error: `upstream ${res.status}` },
      502,
    );
  }
  const body = await res.json();

  // Cloudflare 会返回一长串 urls（stun、tcp、udp 全家桶），筛出主力链路；
  // 万一筛完为空（上游改了格式），就退回全部 turn(s) 条目，保证可用性。
  const iceServers = (body.iceServers || []).map((s) => {
    const urls = Array.isArray(s.urls) ? s.urls : [s.urls];
    const turn = urls.filter((u) => /^turns?:/i.test(u));
    const kept = turn.filter((u) => KEEP.some((re) => re.test(u)));
    return { ...s, urls: kept.length ? kept : turn };
  });

  return json(
    { enabled: true, iceServers, ttl },
    200,
    // 短期凭证不缓存，别让中间层把过期凭证发给下一个设备
    { "cache-control": "no-store" },
  );
}
