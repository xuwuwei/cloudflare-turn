# LensLink TURN 中继服务（Cloudflare Workers）

给 [LensLink](https://github.com/) 双端监控用的中继凭证服务：部署到你自己的
Cloudflare 账号，用 Cloudflare Realtime TURN 现签**短期 ICE 凭证**，两台设备
网络打不穿时自动走中继转发画面。

- ✅ **一键克隆部署**：点下面的按钮，Cloudflare 会把仓库克隆到你自己的 GitHub 并直接部署
- ✅ 免费额度 **1000 GB/月**，超量 $0.05/GB
- ✅ 凭证默认 **1 小时**自动轮换，App 每次建连前来换，不存在过期失效
- ✅ 无数据库、无状态，一个 Worker 搞定

<a href="https://deploy.workers.cloudflare.com/?url=https://github.com/你的GitHub用户名/lenslink-turn"><img src="https://deploy.workers.cloudflare.com/button" alt="Deploy to Cloudflare"/></a>

> 把上面链接里的 `你的GitHub用户名/lenslink-turn` 换成你 fork / 推送后的仓库地址。

---

## 部署前准备：创建 TURN Key（约 2 分钟）

1. 注册 / 登录 [Cloudflare](https://dash.cloudflare.com/)（免费）。
2. 左侧菜单打开 **Realtime → TURN**，点 **创建 TURN 应用**（Create TURN app）。
3. 记下两个值：
   - **Turn 令牌 ID**（Turn Token ID）
   - **API 令牌**（API Token）——⚠️ 只显示一次，当场复制
4. 拿着这两个值进入下面的部署流程。

## 方式一：一键部署（推荐）

1. 先把本仓库推送到你自己的 GitHub（或直接用上面的按钮 fork 克隆）。
2. 点击 **Deploy to Cloudflare** 按钮。
3. 部署页面会让你填两个 secret（对应 `.dev.vars.example`）：
   - `TURN_KEY_ID` → 你的 Turn 令牌 ID
   - `TURN_KEY_TOKEN` → 你的 API 令牌
4. 点确认，Cloudflare 自动克隆仓库 → 创建 Worker → 部署上线，全程无需本地环境。
5. 部署完成会给你一个地址，例如 `https://lenslink-turn.你的子域.workers.dev`。

## 方式二：命令行部署

```bash
git clone https://github.com/你的GitHub用户名/lenslink-turn
cd lenslink-turn
npm install

# 写入两个 secret（跟部署页面里填的是同两个值）
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_TOKEN

npx wrangler deploy
```

---

## 验证

部署完打开：

```
https://你的Worker地址/health
```

看到 `"turn": { "enabled": true }` 就说明配好了：

```json
{ "status": "ok", "version": "1.0.0", "turn": { "enabled": true } }
```

浏览器直接访问 `/v1/turn-credentials`，能看到一组带过期时间的短期凭证。

## 在 LensLink 里使用

1. 打开 App（**两台设备都要**）→ 摄像头端就绪页的「中继服务器」入口（或设置页）。
2. 中继服务地址填：`https://你的Worker地址`
   （`https://` 开头 = 凭证服务模式，**用户名密码留空**，App 会自动换凭证。）
3. 历史记录会记住这套配置，下次一键切回。两台设备务必填**同一个**地址。

## API

LensLink App 与本服务只约定这两个端点（改形状会破坏兼容）：

| 端点 | 返回 | 用途 |
|---|---|---|
| `GET /health` | `{ status, version, turn: { enabled } }` | App 保存中继前探测配置是否就绪 |
| `GET /v1/turn-credentials` | `{ enabled, iceServers: [{ urls, username, credential }], ttl }` | 建连前换短期凭证 |

返回的 ICE 只保留两条主力链路：`turn:…:3478?transport=udp`（延迟最低）和
`turns:…:443?transport=tcp`（只放行 443 的网络兜底）。

## 配置项

| 名称 | 类型 | 说明 |
|---|---|---|
| `TURN_KEY_ID` | secret（必填） | Cloudflare TURN 令牌 ID |
| `TURN_KEY_TOKEN` | secret（必填） | Cloudflare TURN API 令牌 |
| `TURN_TTL` | var（可选） | 凭证有效期秒数，默认 `3600`，最小 300 |

## 安全与成本

- 凭证由 Cloudflare 下签，暴露的只是**短期** username/credential，泄露了也会很快过期；
  `TURN_KEY_TOKEN` 永远只存在你的 Worker secret 里，不会下发给设备。
- 中继只搬运加密的 WebRTC 媒体流，不存储任何内容；两台设备不建立连接时零流量。
- Cloudflare Realtime TURN 免费额度 1000 GB/月（720p 一路约 0.45 GB/小时），
  个人监控场景基本用不完。

## License

MIT
