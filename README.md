# Cloudflare Astro 博客模板

这是一个基于 `Astro + Hono + Cloudflare Workers` 的博客模板，带前台页面、后台管理、媒体库、统计、搜索、友链、Webmention、MCP 发帖接口，以及可选的 Giscus 评论区。

> 先提前说一句：**这不是一个只要 `npm build` 就能直接上线的纯静态博客**。
>
> 它的实际运行方式是：
>
> - 前台页面由 `Astro` 渲染
> - 后台与 API 由 `Hono` 跑在 Cloudflare Workers 上
> - 数据放在 `D1`
> - 会话和限流放在 `KV`
> - 媒体文件放在 `R2`
> - 搜索依赖构建阶段生成的 `Pagefind` 索引
> - 评论区使用 `Giscus + GitHub Discussions`
> - 日常代码发布主要依赖 **Cloudflare Dashboard 的 Git 自动构建**
> - 后台发布文章后如果想让搜索立即更新，可以再接上 **GitHub Actions 自动重建**

如果你是从 B 站或者 GitHub 点进来的，想部署一份自己的同款博客，这份 README 就是给你准备的。

## 目录

- [项目一图看懂](#项目一图看懂)
- [给 AI / 接手维护的人](#给-ai--接手维护的人)
- [部署前先看：你必须自己改的地方](#部署前先看你必须自己改的地方)
- [技术栈](#技术栈)
- [目录结构](#目录结构)
- [完整部署路线图](#完整部署路线图)
- [详细部署教程](#详细部署教程)
- [Pagefind 搜索是怎么工作的](#pagefind-搜索是怎么工作的)
- [后台发文后自动重建：Cloudflare + GitHub Actions 联动](#后台发文后自动重建cloudflare--github-actions-联动)
- [Giscus 评论区配置](#giscus-评论区配置)
- [可选功能配置清单](#可选功能配置清单)
- [本地开发](#本地开发)
- [常用命令](#常用命令)
- [SEO 与订阅](#seo-与订阅)
- [部署前检查](#部署前检查)
- [上线后维护速查](#上线后维护速查)
- [常见问题](#常见问题)
- [许可证](#许可证)

## 项目一图看懂

### 1. 平时改代码怎么上线

```text
你 push 到 GitHub
        ↓
Cloudflare Dashboard 连接仓库后自动构建
        ↓
执行 npm run build
        ↓
scripts/build-pagefind-index.mjs 生成搜索索引
        ↓
astro build 输出 Worker + 静态资源
        ↓
Cloudflare 自动部署上线
```

### 2. 后台发文章后，为什么还要额外重建

```text
后台发布文章
    ↓
D1 里的文章数据已经更新
    ↓
但 Pagefind 搜索索引还是“上一次构建时生成的文件”
    ↓
所以如果你想让搜索结果立刻包含新文章
    ↓
就需要再触发一次构建 / 部署
```

本仓库已经把这条链路准备好了：

```text
后台发布文章
    ↓
src/admin/lib/deploy-hook.ts 触发 webhook
    ↓
GitHub Actions workflow: .github/workflows/auto-deploy-from-admin.yml
    ↓
执行 npm run deploy
    ↓
远端 D1 迁移 + 远端 Pagefind 重建 + wrangler deploy
```

### 3. 评论区怎么来的

```text
文章页 CommentsPanel
    ↓
public/comments.js 在用户展开评论区时动态加载 giscus
    ↓
Giscus 读取 GitHub Discussions
```

所以评论区不是博客自己存评论，而是借 GitHub Discussions 来做。

## 给 AI / 接手维护的人

如果以后你要让 AI 帮你维护，先看这几个文件最省时间：

- `wrangler.jsonc`：Worker 名称、D1 / KV / R2 绑定、站点变量。
- `.dev.vars.example`：本地开发所需变量模板。
- `src/lib/types.ts`：站点标题、站点 URL、作者信息、Giscus 评论配置。
- `scripts/build-pagefind-index.mjs`：Pagefind 索引生成逻辑，会读 D1。
- `.github/workflows/auto-deploy-from-admin.yml`：后台发文后自动触发 GitHub Actions 部署。
- `src/admin/lib/deploy-hook.ts`：后台何时触发 webhook。
- `src/components/CommentsPanel.astro` + `public/comments.js`：评论区加载逻辑。
- `docs/maintenance-guide.md`：上线后维护规范。

## 部署前先看：你必须自己改的地方

这个仓库已经带了我自己的站点信息，所以**你 Fork 以后，至少要改下面这些内容**，不然会出现“页面能跑，但是还是我的名字 / 我的评论区 / 我的资源域名”的情况。

### 1. 先 Fork 仓库

推荐流程：

1. 先在 GitHub 上 `Fork` 这个仓库到你自己的账号。
2. 再克隆你自己的 Fork。
3. 后续 Cloudflare、Giscus、GitHub OAuth、GitHub Actions 都指向你自己的仓库。

### 2. 必改文件清单

#### `src/lib/types.ts`

这里控制：

- 博客标题
- 站点主域名
- 作者名
- 站点描述
- Giscus 评论仓库与分类配置

如果你不想立刻启用评论区，**至少把评论配置改成你自己的，或者先清空**，不要继续指向原仓库。

#### `wrangler.jsonc`

这里控制：

- Worker 名称 `name`
- D1 数据库绑定与 `database_id`
- KV 命名空间绑定与 `id`
- R2 bucket 绑定与 `bucket_name`
- `SITE_NAME`
- `SITE_URL`

你不能直接用仓库里现成的资源 ID；那是原站点的配置。

#### 如果你要换成自己的 Logo / 图床 / 品牌

至少检查这些文件：

- `src/components/BaseHead.astro`
- `src/components/Header.astro`
- `src/admin/views/login.ts`
- `src/components/Footer.astro`
- `src/middleware.ts`
- `src/admin/app.ts`

原因很简单：

- 前 4 个文件里有品牌文案、图标、页脚信息
- 后 2 个文件里有 CSP 白名单；如果你把 Logo 外链域名换了，CSP 也得一起改

### 3. 最省事的排查命令

把下面这条命令跑一遍，能快速找出仓库里还残留的原站点信息：

```bash
rg -n "Eric-Terminal|ericterminal\.com|assets\.ericterminal\.com|萌ICP备|R_kgD|DIC_" src public README.md wrangler.jsonc
```

## 技术栈

| 分层 | 技术 |
| --- | --- |
| 前台页面 | `Astro` |
| 后台与接口 | `Hono` |
| 数据库 | `Cloudflare D1` + `Drizzle ORM` |
| 会话与限流 | `Cloudflare KV` |
| 媒体文件 | `Cloudflare R2` |
| 运行时 | `Cloudflare Workers` |
| 搜索 | `Pagefind` |
| 评论 | `Giscus` + `GitHub Discussions` |
| 检查与格式化 | `Biome` |
| 测试 | `tsx + node:test` |

## 目录结构

```text
src/
├── admin/                  # 后台子应用、认证中间件和 HTML 模板
├── components/             # 前台组件（含评论区、搜索等）
├── db/                     # Drizzle schema
├── layouts/                # 公共布局
├── lib/                    # 安全工具、数据库访问、站点配置与共享类型
├── pages/                  # Astro 页面与 API 入口
└── styles/                 # 全局样式
public/
├── admin.js                # 后台交互脚本
├── comments.js             # Giscus 动态加载脚本
├── pagefind-search.js      # 搜索页前端逻辑
└── pagefind/               # Pagefind 构建产物
scripts/
├── build-pagefind-index.mjs # 从 D1 生成 Pagefind 索引
├── hash-password.mjs        # 生成后台密码哈希（旧兼容用途）
└── seed.sql                 # 示例数据
.github/workflows/
└── auto-deploy-from-admin.yml # 后台触发的自动部署工作流
docs/
└── maintenance-guide.md     # 上线后维护指南
tests/
├── integration/
└── unit/
```

## 完整部署路线图

如果你只想先知道全流程，大概就是这 9 步：

1. Fork 仓库，改成你自己的站点信息。
2. 在 Cloudflare 创建 D1 / KV / R2 资源。
3. 修改 `wrangler.jsonc`，填入你自己的资源 ID 和站点域名。
4. 在 GitHub 创建 OAuth App，给后台登录用。
5. 在 Cloudflare Dashboard 里连接 GitHub 仓库，开启自动构建。
6. 在 Cloudflare 项目里配置 Variables 和 Secrets。
7. 首次执行一次远端数据库迁移：`npm run db:migrate:remote`。
8. 上线后手动验证：首页、归档、后台登录、发文、搜索、媒体上传。
9. 如果你希望“后台一发布文章，搜索就立刻更新”，再配置 GitHub Actions 自动重建。

下面是完整细节版。

## 详细部署教程

### 第 0 步：准备账号

你至少需要：

- 一个 GitHub 账号
- 一个 Cloudflare 账号
- 一个你自己拥有的仓库（Fork 也行）

可选但很推荐：

- 一个自定义域名
- 一个你自己的 Logo / 头像 / 品牌图片

### 第 1 步：Fork 仓库并改基础信息

先克隆你自己的 Fork：

```bash
git clone https://github.com/你的用户名/cf-astro-blog.git
cd cf-astro-blog
npm install
```

#### 1.1 先改 `src/lib/types.ts`

你至少要把下面这些值改掉：

- `name`
- `url`
- `description`
- `author`
- `comments.repo`
- `comments.repoId`
- `comments.category`
- `comments.categoryId`

如果你还没配置 Giscus，可以先保留：

- `provider: "giscus"`
- `mapping: "pathname"`
- `strict: false`
- `reactionsEnabled: true`
- `inputPosition: "top"`
- `lang: "zh-CN"`

但 `repo / repoId / category / categoryId` 不要继续沿用原仓库。

#### 1.2 如果你要换品牌，再改这些地方

- 页头 Logo / favicon：`src/components/BaseHead.astro`、`src/components/Header.astro`
- 后台登录页品牌信息：`src/admin/views/login.ts`
- 页脚备案和版权：`src/components/Footer.astro`
- 默认作者名 / 侧边栏默认文案：`src/lib/site-appearance.ts`、`src/db/schema.ts`

#### 1.3 如果你用了新的外链图片域名，别忘了改 CSP

如果你不再使用 `assets.ericterminal.com`，而是改成你自己的图床域名，还需要同步改：

- `src/middleware.ts`
- `src/admin/app.ts`

否则浏览器可能会把图片拦下来。

### 第 2 步：创建 Cloudflare 资源

这个项目运行至少依赖下面 3 个资源：

| 资源 | 绑定名 | 是否必须 | 用途 |
| --- | --- | --- | --- |
| D1 | `DB` | 是 | 文章、分类、标签、统计、友链、Webmention、外观配置 |
| KV | `SESSION` | 是 | 后台会话、登录限流、MCP 限流 |
| R2 | `MEDIA_BUCKET` | 强烈推荐 | 媒体管理与文章图片 |

你可以用 Cloudflare Dashboard 创建，也可以直接用 Wrangler CLI。

#### 2.1 用 Wrangler CLI 创建（可选）

```bash
npx wrangler d1 create blog
npx wrangler kv namespace create SESSION
npx wrangler r2 bucket create blog-media
```

创建完成后，Wrangler 会回显资源 ID / bucket 名称。

#### 2.2 把资源写进 `wrangler.jsonc`

你需要至少改成你自己的版本：

```jsonc
{
  "name": "你的-worker-名称",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "你的-d1-名称",
      "database_id": "你的-d1-id",
      "migrations_dir": "drizzle"
    }
  ],
  "r2_buckets": [
    {
      "binding": "MEDIA_BUCKET",
      "bucket_name": "你的-r2-bucket"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "SESSION",
      "id": "你的-kv-id"
    }
  ],
  "vars": {
    "SITE_NAME": "你的博客名",
    "SITE_URL": "https://你的域名"
  }
}
```

#### 2.3 `name` 一定要唯一

`wrangler.jsonc` 里的 `name` 是 Worker 名称。

- 不要直接沿用 `cf-astro-blog`
- 改成你自己的唯一名字
- Cloudflare Dashboard 里连接 Git 仓库时，项目名 / Worker 名也最好和这里保持一致

### 第 3 步：准备本地开发变量

复制一份本地变量模板：

```bash
cp .dev.vars.example .dev.vars
```

然后按需填写。

本地最常用的几个变量是：

| 名称 | 是否必填 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | 是 | 后台会话签名密钥 |
| `ADMIN_GITHUB_LOGIN` | 是 | 允许登录后台的 GitHub 用户名 |
| `GITHUB_OAUTH_CLIENT_ID` | 是 | GitHub OAuth App Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | 是 | GitHub OAuth App Client Secret |
| `MCP_BEARER_TOKEN` | 可选 | `/api/mcp` Bearer 鉴权令牌 |
| `TURNSTILE_SECRET_KEY` | 可选 | 开启 Turnstile 时需要 |
| `AUTO_DEPLOY_WEBHOOK_URL` | 可选 | 后台发文后自动触发外部部署 |
| `AUTO_DEPLOY_WEBHOOK_SECRET` | 可选 | 部署钩子鉴权令牌 |

### 第 4 步：配置 GitHub OAuth（后台登录必做）

这个后台已经切到 **GitHub OAuth 登录**，不是用户名密码登录了。

也就是说：**如果你不配置 GitHub OAuth，后台基本等于进不去。**

#### 4.1 在 GitHub 创建 OAuth App

进入：

`GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth App`

推荐这样填：

- `Application name`：随便取，比如 `my-blog-admin`
- `Homepage URL`：`https://你的域名`
- `Authorization callback URL`：`https://你的域名/api/auth/github/callback`

创建后你会拿到：

- `Client ID`
- `Client Secret`

#### 4.2 回填到 Cloudflare / 本地环境

你至少需要：

- `ADMIN_GITHUB_LOGIN=你的 GitHub 用户名`
- `GITHUB_OAUTH_CLIENT_ID=...`
- `GITHUB_OAUTH_CLIENT_SECRET=...`

可选：

- `GITHUB_OAUTH_REDIRECT_URI=https://你的域名/api/auth/github/callback`

如果不填 `GITHUB_OAUTH_REDIRECT_URI`，代码会按当前请求域名自动推导回调地址。

### 第 5 步：连接 Cloudflare Dashboard 的 Git 自动部署（推荐）

这一步是日常发布的主线路。

也就是：**你以后正常改代码、提交、push，Cloudflare 会自动构建并上线。**

#### 5.1 连接仓库

大致流程：

1. 进入 Cloudflare Dashboard。
2. 打开 `Workers & Pages`。
3. 选择创建新项目并连接 GitHub 仓库。
4. 选中你自己的 Fork 仓库。
5. 生产分支一般选 `main`。

#### 5.2 构建配置建议

推荐按下面思路配：

- Root Directory：仓库根目录
- Build Command：`npm run build`
- Deploy Command：`npx wrangler deploy`
- Production Branch：`main`

这个仓库的 `npm run build` 实际会做两件事：

1. 先跑 `scripts/build-pagefind-index.mjs` 生成搜索索引
2. 再跑 `astro build`

所以**不要把 Build Command 改成单纯的 `astro build`**，不然搜索索引可能不同步。

#### 5.3 Preview / 非生产分支构建

如果你希望分支或 PR 也自动出预览，可以在 Cloudflare 的分支构建设置里开启非生产分支构建。

这样：

- `main` push -> 生产环境构建
- 其他分支 push -> 预览环境构建

### 第 6 步：在 Cloudflare 项目里配置 Variables 和 Secrets

进入你的 Cloudflare 项目后，在运行时环境里配置变量。

建议 `Production` 和 `Preview` 都配一份，至少核心变量别缺。

#### 6.1 必填项

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `JWT_SECRET` | Secret | 后台会话签名密钥 |
| `ADMIN_GITHUB_LOGIN` | Variable | 允许登录后台的 GitHub 用户名 |
| `GITHUB_OAUTH_CLIENT_ID` | Variable | GitHub OAuth Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | Secret | GitHub OAuth Client Secret |
| `SITE_NAME` | Variable | 站点名称 |
| `SITE_URL` | Variable | 站点主域名 |

#### 6.2 强烈建议配置

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | Variable | 登录页 / 友链申请页验证码站点 Key |
| `TURNSTILE_SECRET_KEY` | Secret | 验证码服务端密钥 |
| `MCP_BEARER_TOKEN` | Secret | `/api/mcp` 的 Bearer 鉴权令牌 |

#### 6.3 可选项

| 名称 | 类型 | 说明 |
| --- | --- | --- |
| `GITHUB_OAUTH_REDIRECT_URI` | Variable | 自定义 OAuth 回调地址 |
| `AUTO_DEPLOY_WEBHOOK_URL` | Variable | 后台发文后自动触发构建 |
| `AUTO_DEPLOY_WEBHOOK_SECRET` | Secret | 部署钩子鉴权令牌 |
| `AUTO_DEPLOY_GITHUB_EVENT_TYPE` | Variable | GitHub dispatch 事件名，默认 `rebuild-search-index` |
| `MCP_RATE_LIMIT_PER_MINUTE` | Variable | MCP 每分钟每 IP 限流 |
| `MCP_AUTH_FAIL_LIMIT_PER_MINUTE` | Variable | MCP 鉴权失败阈值 |
| `MCP_AUTH_BLOCK_SECONDS` | Variable | MCP 临时封禁秒数 |
| `AI_INTERNAL_API_KEY` | Secret / Variable | 后台 AI 能力用 |
| `AI_PUBLIC_API_KEY` | Secret / Variable | 前台公开 AI 功能用 |
| `PUBLIC_AI_RATE_LIMIT_PER_MINUTE` | Variable | 公开 AI 每分钟每 IP 限流 |
| `PUBLIC_AI_DAILY_LIMIT_PER_IP` | Variable | 公开 AI 每日每 IP 限额 |

#### 6.4 资源绑定也别漏

除了变量，还要确认 Cloudflare 项目本身已经绑定：

- `DB`（D1）
- `SESSION`（KV）
- `MEDIA_BUCKET`（R2）

### 第 7 步：首次执行远端数据库迁移（一定要做）

这一条非常重要。

**Cloudflare 自动构建会帮你部署代码，但不会自动替你初始化 D1 表结构。**

所以第一次上线前，至少要手动执行一次：

```bash
npm run db:migrate:remote
```

如果你本地还没登录 Wrangler，先登录：

```bash
npx wrangler login
```

> 以后只要 `drizzle/` 里新增了 migration，也要再跑一次 `npm run db:migrate:remote`。
>
> 如果只是改前端样式、页面文案、接口逻辑，但**没改数据库结构**，那正常 `push` 让 Cloudflare 自动构建就够了。

### 第 8 步：本地先跑起来（非常推荐）

推荐先本地确认一遍：

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

如果你想给本地 D1 塞一点示例数据，也可以：

```bash
npm run db:seed:local
```

然后重点看看：

- 首页和归档页能否正常打开
- 搜索页有没有索引
- 后台登录页是否显示 GitHub 登录按钮
- 新建文章能否保存
- 图片上传是否正常

### 第 9 步：首次上线后建议验证这几件事

上线后请按这个顺序自测：

1. 首页是否正常显示
2. `/blog` 归档页是否正常
3. `/search` 搜索页是否能查到文章
4. `/api/auth/login` 是否能用 GitHub OAuth 登录后台
5. 后台新建一篇文章并发布
6. 如果启用了 R2，测试上传图片
7. 打开一篇文章，看评论区是否是你的 Giscus 配置

## Pagefind 搜索是怎么工作的

这个项目的搜索不是实时查数据库，而是构建时生成静态索引。

### 关键文件

- 索引脚本：`scripts/build-pagefind-index.mjs`
- 索引输出目录：`public/pagefind/`
- 元数据文件：`public/pagefind-meta.json`
- 前端搜索逻辑：`public/pagefind-search.js`

### 构建逻辑

`npm run build` 会默认先执行：

```bash
npm run search:index:auto
```

也就是：

1. 优先读本地 D1
2. 如果本地没文章，就自动回退远端 D1
3. 根据公开文章生成 Pagefind 索引
4. 再执行 `astro build`

### 你需要记住的重点

- **搜索结果来自构建产物，不是实时数据库查询。**
- 后台发布文章后，文章页会立刻能访问；但搜索结果是否马上更新，取决于你有没有重新构建。
- 如果你配置了“后台发文 -> GitHub Actions 自动部署”，搜索会自动跟上。
- 如果你没配，那就等你下次手动 `push` 或手动部署时再更新。

### 相关命令

| 命令 | 说明 |
| --- | --- |
| `npm run search:index:auto` | 优先读取本地 D1，若为空自动回退远端 D1 |
| `npm run search:index:local` | 强制读取本地 D1 并生成索引 |
| `npm run search:index:remote` | 强制读取远端 D1 并生成索引 |

## 后台发文后自动重建：Cloudflare + GitHub Actions 联动

这是这个仓库比较容易让人绕晕，但其实也最实用的一段。

### 先理解一下职责分工

#### 平时改代码

- 你 `push`
- Cloudflare Dashboard 自动构建和部署

#### 后台发布文章

- 后台先把文章写入 D1
- 然后通过 `AUTO_DEPLOY_WEBHOOK_URL` 去触发外部构建
- 本仓库默认推荐触发 GitHub `repository_dispatch`
- GitHub Actions 再执行 `npm run deploy`

### 仓库里已经带好的文件

- webhook 触发逻辑：`src/admin/lib/deploy-hook.ts`
- GitHub Actions 工作流：`.github/workflows/auto-deploy-from-admin.yml`

### 你要配置什么

#### 1. Cloudflare 运行时变量

```text
AUTO_DEPLOY_WEBHOOK_URL=https://api.github.com/repos/<owner>/<repo>/dispatches
AUTO_DEPLOY_WEBHOOK_SECRET=<一个能调用该仓库 dispatch API 的 GitHub Token>
AUTO_DEPLOY_GITHUB_EVENT_TYPE=rebuild-search-index
```

其中：

- `AUTO_DEPLOY_WEBHOOK_URL` 指向你自己的仓库，不是原仓库
- `AUTO_DEPLOY_WEBHOOK_SECRET` 建议使用：
  - 经典 PAT：带 `repo` scope
  - 或细粒度 PAT：至少对该仓库有 `Contents: write`

#### 2. GitHub 仓库 Secrets

工作流支持两种 Cloudflare 凭据方案：

**方案 A：推荐，最稳**

- `CLOUDFLARE_API_TOKEN`

**方案 B：备选**

- `CLOUDFLARE_REFRESH_TOKEN`
- 如果你想让工作流自动回写新的 refresh token，还要再加：`GH_ADMIN_TOKEN`

### 这条工作流会做什么

`.github/workflows/auto-deploy-from-admin.yml` 会：

1. 接收 `repository_dispatch`
2. 安装依赖
3. 准备 Cloudflare Token
4. 执行 `npm run deploy`

而 `npm run deploy` 会做：

```text
npm run db:migrate:remote
npm run search:index:remote
astro build
wrangler deploy
```

也就是说，它会直接用**远端 D1** 重建索引，再部署一次。

### 推荐测试方法

1. 先把整站正常上线
2. 配好上面的 webhook 和 GitHub Secrets
3. 登录后台
4. 发布一篇新文章
5. 去 GitHub Actions 看 `后台发布自动部署` 有没有触发
6. 等 Actions 完成后，再去站内搜索里搜新文章标题

如果搜到了，说明整条链路已经打通。

## Giscus 评论区配置

这个项目的评论区是 **Giscus**，也就是 GitHub Discussions 评论。

### 你需要准备什么

1. 你自己的 GitHub 仓库
2. 给这个仓库开启 `Discussions`
3. 在 Discussions 里选一个分类给评论用
4. 去 `https://giscus.app/zh-CN` 生成配置

### 配置步骤

#### 1. 开启 GitHub Discussions

在你的 GitHub 仓库里打开 Discussions。

#### 2. 准备一个分类

最常见就是直接用 `Announcements`，也可以自己建别的。

#### 3. 去 giscus.app 获取参数

Giscus 页面会帮你拿到这些值：

- `repo`
- `repoId`
- `category`
- `categoryId`

#### 4. 回填到 `src/lib/types.ts`

示例结构如下：

```ts
comments: {
  provider: "giscus",
  repo: "你的用户名/你的仓库",
  repoId: "你的 repoId",
  category: "Announcements",
  categoryId: "你的 categoryId",
  mapping: "pathname",
  strict: false,
  reactionsEnabled: true,
  inputPosition: "top",
  lang: "zh-CN",
}
```

### 这个项目的评论区有什么特点

- 默认折叠，用户点开后才会加载 Giscus
- 会跟随深浅色主题自动切换
- 如果仓库没配好 Discussions，会在页面上显示提示，而不是直接白屏

### 如果你暂时不想启用评论区

最简单的做法有两个：

1. 把 `src/lib/types.ts` 里的评论配置改成你自己的真实值后再启用
2. 或者先清空评论关键字段，让组件进入“未配置”状态

总之不要继续指向原仓库，不然评论会跑到错误的 Discussions 里。

## 可选功能配置清单

| 功能 | 是否必须 | 配置位置 | 说明 |
| --- | --- | --- | --- |
| Turnstile | 否 | `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | 登录页、友链申请的人机验证 |
| Giscus 评论区 | 否 | `src/lib/types.ts` | GitHub Discussions 评论 |
| 媒体管理 | 强烈推荐 | `MEDIA_BUCKET` | 后台上传图片 |
| 后台自动重建 | 否，但很推荐 | `AUTO_DEPLOY_*` + GitHub Actions Secrets | 后台发文后自动更新搜索 |
| MCP 发帖接口 | 否 | `MCP_BEARER_TOKEN` 等 | 给外部 AI / 自动化工具发帖 |
| 公开 AI 功能 | 否 | `AI_PUBLIC_API_KEY` 等 | 前台公开 AI 能力 |
| 后台 AI 功能 | 否 | `AI_INTERNAL_API_KEY` 等 | 后台 AI 能力 |

## 本地开发

推荐使用 `Node.js 22+` 和 `npm`。

```bash
git clone https://github.com/你的用户名/cf-astro-blog.git
cd cf-astro-blog
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

如需生成后台密码哈希，可执行：

```bash
npm run hash:password -- 你的密码
```

> 说明：当前后台主流程已经是 GitHub OAuth 登录。
>
> `ADMIN_PASSWORD_HASH` 主要是为了兼容旧配置或保留脚本能力，不再是推荐的登录方式。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 生成生产构建（会先生成 Pagefind 索引） |
| `npm run preview` | 构建后用 Wrangler 本地预览 |
| `npm run deploy` | 远端迁移 + 远端索引 + 构建 + deploy |
| `npm run check` | 运行类型检查和 Biome 检查 |
| `npm run lint` | 运行 Biome lint |
| `npm run format` | 格式化源码、脚本、测试与 README |
| `npm test` | 运行自动化测试 |
| `npm run db:migrate:local` | 应用本地 D1 迁移 |
| `npm run db:migrate:remote` | 应用线上 D1 迁移 |
| `npm run db:seed:local` | 为本地 D1 导入示例数据 |
| `npm run db:seed:remote` | 为远端 D1 导入示例数据（谨慎使用） |
| `npm run search:index:auto` | 自动选择本地 / 远端 D1 生成搜索索引 |
| `npm run search:index:local` | 强制读取本地 D1 生成搜索索引 |
| `npm run search:index:remote` | 强制读取远端 D1 生成搜索索引 |

## SEO 与订阅

- `sitemap.xml`：由 `src/pages/sitemap.xml.ts` 动态输出，包含公开页面和可见文章。
- `rss.xml`：由 `src/pages/rss.xml.ts` 动态输出，默认收录最近 30 篇公开文章。
- `robots.txt`：由 `src/pages/robots.txt.ts` 输出，允许公开页面抓取，屏蔽后台登录与管理相关路径（`/api/auth`、`/api/admin`、`/admin`）。
- `webmention`：由 `src/admin/routes/webmention.ts` 提供接收端点 `/api/webmention`，通过 `source/target` 校验后写入待审核队列；后台在 `/api/admin/mentions` 进行审核。

## 部署前检查

上线前至少确认下面这些：

1. `wrangler.jsonc` 已替换成你自己的资源和域名。
2. `src/lib/types.ts` 已改成你自己的站点信息。
3. `JWT_SECRET`、`ADMIN_GITHUB_LOGIN`、`GITHUB_OAUTH_CLIENT_ID`、`GITHUB_OAUTH_CLIENT_SECRET` 已配置。
4. 如果启用了 Turnstile，`TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET_KEY` 都已配置。
5. 如果要启用媒体库，`MEDIA_BUCKET` 已绑定。
6. 如果要启用评论区，Giscus 的 `repoId` 和 `categoryId` 已替换。
7. 已执行一次 `npm run db:migrate:remote`。
8. 上线前已经跑过 `npm run check` 和 `npm test`。

## 上线后维护速查

- 只改 UI / 文案 / 交互 / 接口逻辑（不改 D1 表结构）时：**直接 `push` 即可**，Cloudflare 会自动构建部署。
- 改了数据库结构（新增表 / 字段 / 索引）时：**部署后必须再执行 `npm run db:migrate:remote`**。
- 后台发布文章后如果发现搜索没更新：优先检查 GitHub Actions 自动部署链路是否配置完成。
- 完整维护流程和故障排查请看：[docs/maintenance-guide.md](docs/maintenance-guide.md)。

## 常见问题

### 1. 站点上线了，但标题、Logo、评论区还是原作者的

说明你只把仓库跑起来了，还没做品牌替换。

优先检查：

- `src/lib/types.ts`
- `src/components/BaseHead.astro`
- `src/components/Header.astro`
- `src/admin/views/login.ts`
- `src/components/Footer.astro`

### 2. 后台登录页显示 GitHub OAuth 未配置

优先检查：

- `ADMIN_GITHUB_LOGIN`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI`（如果你手动设置了的话）

### 3. 新文章已经发布了，但搜索搜不到

这通常不是文章没发出去，而是 **Pagefind 还没重建**。

排查顺序：

1. 后台文章状态是不是 `published`
2. GitHub Actions 自动部署有没有触发
3. 如果没配自动部署，那就手动重新构建 / 部署一次

### 4. 数据库报错、页面 500、后台某些列表空白

很大概率是 D1 还没迁移。

执行：

```bash
npm run db:migrate:remote
```

### 5. 图片域名换了，但前台 / 后台不显示

检查是不是只换了图片地址，没改 CSP 白名单：

- `src/middleware.ts`
- `src/admin/app.ts`

### 6. Giscus 评论区打不开或加载的是别人的 Discussions

优先检查 `src/lib/types.ts` 里的：

- `comments.repo`
- `comments.repoId`
- `comments.category`
- `comments.categoryId`

## 许可证

项目使用 [MIT](LICENSE) 许可证。
