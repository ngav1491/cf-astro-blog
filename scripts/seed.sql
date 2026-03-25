-- 本地演示种子数据
-- 使用方式：wrangler d1 execute DB --local --file=scripts/seed.sql

DELETE FROM blog_post_tags;
DELETE FROM blog_posts;
DELETE FROM blog_tags;
DELETE FROM blog_categories;
DELETE FROM sqlite_sequence WHERE name IN ('blog_posts', 'blog_categories', 'blog_tags');

-- 分类
INSERT INTO blog_categories (id, name, slug, description) VALUES
  (1, '教程', 'tutorials', '一步一步讲清楚搭建过程与关键选择'),
  (2, '架构', 'architecture', '围绕系统设计、边界拆分和运行方式的说明'),
  (3, 'Cloudflare', 'cloudflare', '关于 Workers、D1、R2 和边缘部署的实践记录');

-- 标签
INSERT INTO blog_tags (id, name, slug) VALUES
  (1, 'Astro', 'astro'),
  (2, 'Hono', 'hono'),
  (3, 'Cloudflare Workers', 'cloudflare-workers'),
  (4, 'D1', 'd1'),
  (5, 'Drizzle ORM', 'drizzle-orm'),
  (6, 'TypeScript', 'typescript'),
  (7, '服务端渲染', 'ssr'),
  (8, 'HTMX', 'htmx');

-- 文章 1：快速开始
INSERT INTO blog_posts (
  id,
  title,
  slug,
  content,
  excerpt,
  status,
  published_at,
  meta_title,
  meta_description,
  category_id,
  author_name
) VALUES (
  1,
  '用 Astro、Hono 和 Cloudflare 搭一个带后台的博客',
  'getting-started',
  '## 这套模板解决了什么问题

如果你想要一个真正能长期维护的个人博客，通常会同时在意三件事：

- 前台要足够轻，读文章时不能像在逛后台系统
- 后台要能直接写内容，不想每次都手动发版
- 部署要简单，最好能直接跑在边缘网络上

这个模板把这三件事拼到了一起。前台交给 **Astro**，后台和接口交给 **Hono**，运行环境是 **Cloudflare Workers**。

## 为什么这样组合

**Astro** 负责公开页面，页面结构轻、生成结果干净，适合博客这种以阅读为主的站点。

**Hono** 负责后台与 API，路由简单、类型清楚，也很适合跑在 Workers 这种边缘运行时里。

**Cloudflare** 提供了完整的底层能力：

- **Workers** 负责执行服务端逻辑
- **D1** 存文章和结构化数据
- **R2** 存图片和媒体资源
- **KV** 放会话和一些轻量缓存

## 快速启动

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run db:seed:local
npm run dev
```

如果你只想先看前台页面，上面这些就够了。等确认界面方向以后，再去调整域名、图片和后台权限。

## 开箱即用的能力

1. 公开博客首页、归档页、详情页和搜索页
2. `/api/admin` 后台管理入口
3. Markdown 写作与预览
4. RSS 与站点地图
5. 可继续扩展的媒体管理与统计能力

## 建议的使用方式

先把内容模型和前台气质定下来，再去追求很重的后台能力。对个人博客来说，界面表达和写作节奏往往比功能数量更重要。',
  '一套真正能跑在 Cloudflare 上、同时兼顾前台阅读体验和后台编辑体验的博客起步方案。',
  'published',
  '2026-02-09T10:00:00.000Z',
  '用 Astro、Hono 和 Cloudflare 搭一个带后台的博客',
  '从本地开发到边缘部署，快速理解这套博客模板的组成方式与启动流程。',
  1,
  'Eric'
);

-- 文章 2：架构拆解
INSERT INTO blog_posts (
  id,
  title,
  slug,
  content,
  excerpt,
  status,
  published_at,
  meta_title,
  meta_description,
  category_id,
  author_name
) VALUES (
  2,
  'Astro 和 Hono 为什么适合放在同一个 Workers 项目里',
  'architecture-astro-hono',
  '## 双框架并存并不冲突

很多人看到一个项目里同时有 Astro 和 Hono，会第一反应觉得复杂。其实这里的关键不是技术越多越好，而是职责是否足够清楚。

- **Astro** 只负责公开访问的页面
- **Hono** 只负责后台、认证和 API

它们最后共享同一套 Cloudflare 绑定，但各自只处理自己擅长的那一部分。

## 请求是怎么流转的

一次请求进来以后，大致会落到下面两类入口里：

```text
/                → 首页
/blog            → 归档页
/blog/:slug      → 文章详情
/search          → 搜索页
/rss.xml         → 订阅源
/sitemap.xml     → 站点地图
/api/*           → 后台与接口
```

这意味着前台阅读链路和后台管理链路天然分开，页面不会为了后台能力背上过重的客户端负担。

## 共享资源层

无论是 Astro 还是 Hono，底层都读同一套资源：

| 绑定 | 用途 |
| --- | --- |
| `DB` | 文章、分类、标签、统计数据 |
| `MEDIA_BUCKET` | 图片与媒体资源 |
| `SESSION` | 登录态与轻量缓存 |

这种结构的好处在于：前台和后台看起来像两个子系统，但数据源并没有分裂。

## 为什么不只用一个框架

如果只用 Astro，你还是能做后台，但管理端交互和接口组织会越来越拧巴。

如果只用 Hono，也不是不行，但公开页面排版与内容组织会少一点 Astro 这种内容站友好的表达能力。

所以这里真正的设计目标不是炫技，而是让公开内容和后台管理各自足够顺手。',
  '把公开页面和后台接口拆到不同职责里，反而让整个 Workers 项目更清楚、更稳。',
  'published',
  '2026-02-09T14:00:00.000Z',
  'Astro 和 Hono 为什么适合放在同一个 Workers 项目里',
  '从路由、绑定和职责边界三个角度，理解双框架在同一个边缘项目里的协作方式。',
  2,
  'Eric'
);

-- 文章 3：Cloudflare 价值
INSERT INTO blog_posts (
  id,
  title,
  slug,
  content,
  excerpt,
  status,
  published_at,
  meta_title,
  meta_description,
  category_id,
  author_name
) VALUES (
  3,
  '为什么个人博客放在 Cloudflare Workers 上会很舒服',
  'why-cloudflare-workers',
  '## 边缘优先的体验到底好在哪

个人博客最怕两种情况：

- 写作流程太重，更新一次像在维护系统
- 访问链路太脆，随便加一点功能就要担心性能和账单

Cloudflare Workers 的好处不是神秘，而是足够直接：部署简单、启动快、离读者近。

## 这套组合分别解决什么

**Workers** 负责执行逻辑，不需要自己管服务器和容器。

**D1** 让结构化内容可以直接查询，不需要回到传统的重型数据库配置。

**R2** 适合存图片与附件，尤其是博客这类读多写少的场景。

**KV** 很适合做会话、限流计数和轻量缓存。

## 对博客来说，真正有价值的是这些

1. 文章发布后不必重新做一整套重部署编排
2. 搜索、后台、内容页能共享同一套边缘环境
3. 流量不大的时候成本非常友好
4. 想继续扩展 CMS 能力时，底层能力已经在场

## 适合谁

这套方案尤其适合两类人：

- 想自己掌控站点，又不想维护传统 VPS 的个人开发者
- 希望博客可以慢慢长成完整内容系统的人

如果你后面要接自动化写作、MCP、图片管理或者更细的权限控制，Cloudflare 这套底座也比较容易继续往上长。',
  '对个人博客来说，Cloudflare Workers 不是噱头，而是一种部署、性能和扩展性都比较平衡的底座。',
  'published',
  '2026-02-10T08:00:00.000Z',
  '为什么个人博客放在 Cloudflare Workers 上会很舒服',
  '从部署体验、运行成本和后续扩展三个角度，解释为什么个人博客很适合跑在 Cloudflare Workers 上。',
  3,
  'Eric'
);

-- 文章与标签关联
INSERT INTO blog_post_tags (post_id, tag_id) VALUES (1, 1), (1, 2), (1, 3), (1, 4), (1, 6);
INSERT INTO blog_post_tags (post_id, tag_id) VALUES (2, 1), (2, 2), (2, 7), (2, 8), (2, 5);
INSERT INTO blog_post_tags (post_id, tag_id) VALUES (3, 3), (3, 4), (3, 7);
