# Cloudflare Astro Blog Template

Đây là một template blog dựa trên `Astro + Hono + Cloudflare Workers`, bao gồm trang chính, trang quản trị, thư viện media, thống kê, tìm kiếm, liên kết bạn bè, Webmention, giao diện đăng bài MCP và phần bình luận Giscus tùy chọn.

> Trước tiên, xin lưu ý: **Đây không phải là một blog tĩnh chỉ cần `npm build` là có thể deploy được ngay**.

> Cách hoạt động thực tế:
>
> - Trang chính được render bởi `Astro`
> - Trang quản trị và API chạy trên `Hono` trong Cloudflare Workers
> - Dữ liệu được lưu trong `D1`
> - Phiên làm việc và giới hạn tốc độ trong `KV`
> - File media trong `R2`
> - Tìm kiếm phụ thuộc vào chỉ mục `Pagefind` được tạo khi build
> - Bình luận sử dụng `Giscus + GitHub Discussions`
> - Phát hành code hàng ngày chủ yếu dựa vào **Cloudflare Dashboard Git auto-build**
> - Sau khi đăng bài từ trang quản trị, nếu muốn cập nhật tìm kiếm ngay, có thể kết nối thêm **GitHub Actions auto rebuild**

Nếu bạn đến từ Bilibili hoặc GitHub và muốn deploy phiên bản blog của riêng mình, file README này là dành cho bạn.

## Mục lục

- [Tổng quan dự án](#tổng-quan-dự-án)
- [Dành cho AI / người bảo trì tiếp theo](#dành-cho-ai--người-bảo-trì-tiếp-theo)
- [Đọc trước khi deploy: Những thứ bạn phải tự thay đổi](#đọc-trước-khi-deploy-những-thứ-bạn-phải-tự-thay-đổi)
- [Tech stack](#tech-stack)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Lộ trình deploy đầy đủ](#lộ-trình-deploy-đầy-đủ)
- [Hướng dẫn deploy chi tiết](#hướng-dẫn-deploy-chi-tiết)
- [Cách hoạt động của tìm kiếm Pagefind](#cách-hoạt-động-của-tìm-kiếm-pagefind)
- [Auto rebuild sau khi đăng bài: Cloudflare + GitHub Actions](#auto-rebuild-sau-khi-đăng-bài-cloudflare--github-actions)
- [Cấu hình bình luận Giscus](#cấu-hình-bình-luận-giscus)
- [Danh sách cấu hình tính năng tùy chọn](#danh-sách-cấu-hình-tính-năng-tùy-chọn)
- [Phát triển cục bộ](#phát-triển-cục-bộ)
- [Các lệnh thường dùng](#các-lệnh-thường-dùng)
- [SEO và Đăng ký](#seo-và-đăng-ký)
- [Kiểm tra trước khi deploy](#kiểm-tra-trước-khi-deploy)
- [Hướng dẫn bảo trì sau khi lên production](#hướng-dẫn-bảo-trì-sau-khi-lên-production)
- [Câu hỏi thường gặp](#câu-hỏi-thường-gặp)
- [Giấy phép](#giấy-phép)

## Tổng quan dự án

### 1. Sửa code thường ngày và deploy như thế nào

```
Bạn push lên GitHub
        ↓
Cloudflare Dashboard tự động build sau khi kết nối repo
        ↓
Thực thi npm run build
        ↓
scripts/build-pagefind-index.mjs tạo chỉ mục tìm kiếm
        ↓
astro build xuất Worker + tài nguyên tĩnh
        ↓
Cloudflare tự động deploy lên production
```

### 2. Sau khi đăng bài từ trang quản trị, tại sao cần rebuild thêm

```
Đăng bài từ trang quản trị
    ↓
Dữ liệu bài viết trong D1 đã được cập nhật
    ↓
Nhưng chỉ mục tìm kiếm Pagefind vẫn là file được tạo từ lần build trước
    ↓
Vì vậy, nếu muốn kết quả tìm kiếm bao gồm bài viết mới ngay
    ↓
Cần trigger thêm một lần build / deploy
```

Repo này đã chuẩn bị sẵn luồng này:

```
Đăng bài từ trang quản trị
    ↓
src/admin/lib/deploy-hook.ts trigger webhook
    ↓
GitHub Actions workflow: .github/workflows/auto-deploy-from-admin.yml
    ↓
Thực thi npm run deploy
    ↓
D1 migration remote + Pagefind rebuild remote + wrangler deploy
```

### 3. Bình luận đến từ đâu

```
CommentsPanel trong trang bài viết
    ↓
public/comments.js load giscus động khi người dùng mở bình luận
    ↓
Giscus đọc GitHub Discussions
```

Vì vậy, bình luận không phải do blog lưu trữ, mà sử dụng GitHub Discussions.

## Dành cho AI / Người bảo trì tiếp theo

Nếu sau này bạn muốn nhờ AI bảo trì, hãy xem các file này trước để tiết kiệm thời gian:

- `wrangler.jsonc`: Worker name, D1/KV/R2 bindings, biến site.
- `.dev.vars.example`: Template biến cho phát triển cục bộ.
- `src/lib/types.ts`: Tiêu đề site, URL site, thông tin tác giả, cấu hình Giscus.
- `scripts/build-pagefind-index.mjs`: Logic tạo chỉ mục Pagefind, đọc từ D1.
- `.github/workflows/auto-deploy-from-admin.yml`: GitHub Actions auto deploy sau khi đăng bài.
- `src/admin/lib/deploy-hook.ts`: Khi nào trigger webhook từ trang quản trị.
- `src/components/CommentsPanel.astro` + `public/comments.js`: Logic load bình luận.
- `docs/maintenance-guide.md`: Quy tắc bảo trì sau khi lên production.

## Đọc trước khi deploy: Những thứ bạn phải tự thay đổi

Repo này đã có sẵn thông tin site của tác giả gốc, vì vậy **sau khi Fork, bạn phải thay đổi ít nhất những thứ sau**, nếu không sẽ xuất hiện tình trạng "trang có thể chạy được, nhưng vẫn hiển thị tên/thông tin bình luận/tài nguyên của người khác".

### 1. Fork repo trước

Quy trình khuyến nghị:

1. Fork repo này vào tài khoản của bạn trên GitHub.
2. Clone Fork của bạn về máy.
3. Các cấu hình Cloudflare, Giscus, GitHub OAuth, GitHub Actions đều trỏ đến repo của bạn.

### 2. Danh sách file bắt buộc phải sửa

#### `src/lib/types.ts`

File này kiểm soát:

- Tiêu đề blog
- Domain chính của site
- Tên tác giả
- Mô tả site
- Cấu hình repo và category của Giscus

Nếu không muốn bật bình luận ngay, **ít nhất hãy sửa thành thông tin của bạn, hoặc xóa trắng**, không nên tiếp tục trỏ đến repo gốc.

#### `wrangler.jsonc`

File này kiểm soát:

- Worker name `name`
- D1 database binding và `database_id`
- KV namespace binding và `id`
- R2 bucket binding và `bucket_name`
- `SITE_NAME`
- `SITE_URL`

Bạn không thể dùng trực tiếp resource ID có sẵn trong repo; đó là cấu hình của site gốc.

#### Nếu muốn đổi Logo / CDN / thương hiệu

Kiểm tra ít nhất các file sau:

- `src/components/BaseHead.astro`
- `src/components/Header.astro`
- `src/admin/views/login.ts`
- `src/components/Footer.astro`
- `src/middleware.ts`
- `src/admin/app.ts`

Lý do đơn giản:

- 4 file đầu có thông tin thương hiệu, icon, footer
- 2 file sau có CSP whitelist; nếu đổi domain CDN cho ảnh, CSP cũng phải sửa theo

### 3. Lệnh kiểm tra nhanh nhất

Chạy lệnh sau để nhanh chóng tìm các thông tin còn lại của site gốc trong repo:

```bash
rg -n "Eric-Terminal|ericterminal\.com|assets\.ericterminal\.com|萌ICP备|R_kgD|DIC_" src public README.md wrangler.jsonc
```

## Tech stack

| Layer | Công nghệ |
| --- | --- |
| Trang chính | `Astro` |
| Trang quản trị & API | `Hono` |
| Database | `Cloudflare D1` + `Drizzle ORM` |
| Phiên & Giới hạn tốc độ | `Cloudflare KV` |
| File media | `Cloudflare R2` |
| Runtime | `Cloudflare Workers` |
| Tìm kiếm | `Pagefind` |
| Bình luận | `Giscus` + `GitHub Discussions` |
| Kiểm tra & Format | `Biome` |
| Test | `tsx + node:test` |

## Cấu trúc thư mục

```
src/
├── admin/                  # Sub-app trang quản trị, middleware auth và template HTML
├── components/             # Components trang chính (bình luận, tìm kiếm...)
├── db/                     # Drizzle schema
├── layouts/                # Layout chung
├── lib/                    # Công cụ bảo mật, truy cập DB, cấu hình site và type chia sẻ
├── pages/                  # Astro pages và entry API
└── styles/                 # Style toàn cục
public/
├── admin.js                # Script tương tác trang quản trị
├── comments.js             # Script load Giscus động
├── pagefind-search.js      # Logic tìm kiếm trang chính
└── pagefind/               # Kết quả build Pagefind
scripts/
├── build-pagefind-index.mjs # Tạo chỉ mục Pagefind từ D1
├── hash-password.mjs        # Tạo hash mật khẩu trang quản trị (tương thích cũ)
└── seed.sql                 # Dữ liệu mẫu
.github/workflows/
└── auto-deploy-from-admin.yml # Workflow auto deploy được trigger từ trang quản trị
docs/
└── maintenance-guide.md     # Hướng dẫn bảo trì sau khi lên production
tests/
├── integration/
└── unit/
```

## Lộ trình deploy đầy đủ

Nếu chỉ muốn biết toàn bộ quy trình, đại khái là 9 bước:

1. Fork repo, sửa thông tin site của bạn.
2. Tạo tài nguyên D1/KV/R2 trên Cloudflare.
3. Sửa `wrangler.jsonc`, điền resource ID và domain của bạn.
4. Tạo OAuth App trên GitHub để đăng nhập trang quản trị.
5. Kết nối GitHub repo trên Cloudflare Dashboard, bật auto build.
6. Cấu hình Variables và Secrets trong Cloudflare project.
7. Lần đầu lên production, thực hiện D1 migration remote: `npm run db:migrate:remote`.
8. Sau khi lên production, tự kiểm tra thủ công: trang chính, lưu trữ, đăng nhập quản trị, đăng bài, tìm kiếm, upload media.
9. Nếu muốn "đăng bài từ trang quản trị xong, tìm kiếm cập nhật ngay", cấu hình thêm GitHub Actions auto rebuild.

Chi tiết bên dưới.

## Hướng dẫn deploy chi tiết

### Bước 0: Chuẩn bị tài khoản

Bạn cần ít nhất:

- Một tài khoản GitHub
- Một tài khoản Cloudflare
- Một repo của riêng bạn (Fork cũng được)

Tùy chọn nhưng khuyến nghị:

- Một domain tùy chỉnh
- Logo/avatar/ảnh thương hiệu của riêng bạn

### Bước 1: Fork repo và sửa thông tin cơ bản

Clone Fork của bạn về:

```bash
git clone https://github.com/TÊN-USER/cf-astro-blog.git
cd cf-astro-blog
npm install
```

#### 1.1 Sửa `src/lib/types.ts` trước

Ít nhất phải sửa các giá trị sau:

- `name`
- `url`
- `description`
- `author`
- `comments.repo`
- `comments.repoId`
- `comments.category`
- `comments.categoryId`

Nếu chưa cấu hình Giscus, có thể giữ nguyên:

- `provider: "giscus"`
- `mapping: "pathname"`
- `strict: false`
- `reactionsEnabled: true`
- `inputPosition: "top"`
- `lang: "zh-CN"`

Nhưng `repo / repoId / category / categoryId` không nên dùng tiếp của repo gốc.

#### 1.2 Nếu muốn đổi thương hiệu, sửa thêm những file này

- Logo/favicon ở header: `src/components/BaseHead.astro`, `src/components/Header.astro`
- Thông tin thương hiệu trang đăng nhập: `src/admin/views/login.ts`
- Beian và bản quyền footer: `src/components/Footer.astro`
- Tên tác giả mặc định / sidebar mặc định: `src/lib/site-appearance.ts`, `src/db/schema.ts`

#### 1.3 Nếu dùng domain ảnh CDN mới, nhớ sửa CSP

Nếu không dùng `assets.ericterminal.com` nữa mà đổi sang domain CDN của bạn, cần sửa thêm:

- `src/middleware.ts`
- `src/admin/app.ts`

Nếu không trình duyệt sẽ chặn ảnh.

### Bước 2: Tạo tài nguyên Cloudflare

Project này cần ít nhất 3 tài nguyên sau để chạy:

| Tài nguyên | Binding | Bắt buộc | Mục đích |
| --- | --- | --- | --- |
| D1 | `DB` | Có | Bài viết, phân loại, thẻ, thống kê, liên kết bạn bè, Webmention, cấu hình giao diện |
| KV | `SESSION` | Có | Phiên quản trị, giới hạn đăng nhập, giới hạn MCP |
| R2 | `MEDIA_BUCKET` | Khuyến nghị mạnh | Quản lý media và ảnh bài viết |

Có thể tạo bằng Cloudflare Dashboard hoặc Wrangler CLI.

#### 2.1 Tạo bằng Wrangler CLI (tùy chọn)

```bash
npx wrangler d1 create blog
npx wrangler kv namespace create SESSION
npx wrangler r2 bucket create blog-media
```

Sau khi tạo xong, Wrangler sẽ hiển thị resource ID / bucket name.

#### 2.2 Ghi resource vào `wrangler.jsonc`

Cần ít nhất sửa thành phiên bản của bạn:

```jsonc
{
  "name": "tên-worker-của-bạn",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "tên-d1-của-bạn",
      "database_id": "d1-id-của-bạn",
      "migrations_dir": "drizzle"
    }
  ],
  "r2_buckets": [
    {
      "binding": "MEDIA_BUCKET",
      "bucket_name": "r2-bucket-của-bạn"
    }
  ],
  "kv_namespaces": [
    {
      "binding": "SESSION",
      "id": "kv-id-của-bạn"
    }
  ],
  "vars": {
    "SITE_NAME": "Tên blog-của-bạn",
    "SITE_URL": "https://domain-của-bạn"
  }
}
```

#### 2.3 `name` phải là duy nhất

`name` trong `wrangler.jsonc` là Worker name.

- Không nên dùng trực tiếp `cf-astro-blog`
- Đổi thành tên duy nhất của bạn
- Khi kết nối Git repo trên Cloudflare Dashboard, project name / Worker name nên giữ nhất quán với đây

### Bước 3: Chuẩn bị biến phát triển cục bộ

Copy template biến cục bộ:

```bash
cp .dev.vars.example .dev.vars
```

Sau đó điền theo nhu cầu.

Các biến thường dùng nhất:

| Tên | Bắt buộc | Mô tả |
| --- | --- | --- |
| `JWT_SECRET` | Có | Khóa ký phiên quản trị |
| `ADMIN_GITHUB_LOGIN` | Có | Username GitHub được phép đăng nhập quản trị |
| `GITHUB_OAUTH_CLIENT_ID` | Có | GitHub OAuth App Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | Có | GitHub OAuth App Client Secret |
| `MCP_BEARER_TOKEN` | Tùy chọn | Bearer token cho `/api/mcp` |
| `TURNSTILE_SECRET_KEY` | Tùy chọn | Cần khi bật Turnstile |
| `AUTO_DEPLOY_WEBHOOK_URL` | Tùy chọn | Trigger auto deploy từ trang quản trị sau khi đăng bài |
| `AUTO_DEPLOY_WEBHOOK_SECRET` | Tùy chọn | Token xác thực deploy hook |

### Bước 4: Cấu hình GitHub OAuth (bắt buộc để đăng nhập quản trị)

Trang quản trị đã chuyển sang **GitHub OAuth login**, không phải đăng nhập bằng username/password.

Nghĩa là: **Nếu không cấu hình GitHub OAuth, về cơ bản không thể vào được trang quản trị.**

#### 4.1 Tạo OAuth App trên GitHub

Truy cập:

`GitHub -> Settings -> Developer settings -> OAuth Apps -> New OAuth App`

Khuyến nghị điền như sau:

- `Application name`: Tùy ý, ví dụ `my-blog-admin`
- `Homepage URL`: `https://domain-của-bạn`
- `Authorization callback URL`: `https://domain-của-bạn/api/auth/github/callback`

Sau khi tạo sẽ có:

- `Client ID`
- `Client Secret`

#### 4.2 Điền vào Cloudflare / môi trường cục bộ

Cần ít nhất:

- `ADMIN_GITHUB_LOGIN=TÊN-USER-GITHUB-CỦA-BẠN`
- `GITHUB_OAUTH_CLIENT_ID=...`
- `GITHUB_OAUTH_CLIENT_SECRET=...`

Tùy chọn:

- `GITHUB_OAUTH_REDIRECT_URI=https://domain-của-bạn/api/auth/github/callback`

Nếu không điền `GITHUB_OAUTH_REDIRECT_URI`, code sẽ tự suy ra callback URL theo domain hiện tại.

### Bước 5: Kết nối Cloudflare Dashboard Git auto deploy (khuyến nghị)

Đây là luồng chính để phát hành hàng ngày.

Nghĩa là: **Sau này, sửa code bình thường, commit, push, Cloudflare sẽ tự động build và deploy.**

#### 5.1 Kết nối repo

Quy trình đại khái:

1. Vào Cloudflare Dashboard.
2. Mở `Workers & Pages`.
3. Chọn tạo project mới và kết nối GitHub repo.
4. Chọn Fork của bạn.
5. Branch sản phẩm thường chọn `main`.

#### 5.2 Cấu hình build khuyến nghị

Đề xuất cấu hình như sau:

- Root Directory: Thư mục gốc repo
- Build Command: `npm run build`
- Deploy Command: `npx wrangler deploy`
- Production Branch: `main`

Repo này `npm run build` thực tế làm 2 việc:

1. Chạy `scripts/build-pagefind-index.mjs` trước để tạo chỉ mục tìm kiếm
2. Sau đó chạy `astro build`

Vì vậy **không nên đổi Build Command thành `astro build` đơn thuần**, nếu không chỉ mục tìm kiếm có thể không đồng bộ.

#### 5.3 Preview / Build branch khác production

Nếu muốn branch hoặc PR cũng auto build preview, có thể bật trong cấu hình branch build của Cloudflare.

Như vậy:

- `main` push -> Build production
- Branch khác push -> Build preview

### Bước 6: Cấu hình Variables và Secrets trong Cloudflare project

Vào Cloudflare project, cấu hình biến trong runtime environment.

Khuyến nghị cấu hình cả Production và Preview, ít nhất các biến cốt lõi không được thiếu.

#### 6.1 Bắt buộc

| Tên | Loại | Mô tả |
| --- | --- | --- |
| `JWT_SECRET` | Secret | Khóa ký phiên quản trị |
| `ADMIN_GITHUB_LOGIN` | Variable | Username GitHub được phép đăng nhập |
| `GITHUB_OAUTH_CLIENT_ID` | Variable | GitHub OAuth Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | Secret | GitHub OAuth Client Secret |
| `SITE_NAME` | Variable | Tên site |
| `SITE_URL` | Variable | Domain chính của site |

#### 6.2 Khuyến nghị cấu hình

| Tên | Loại | Mô tả |
| --- | --- | --- |
| `TURNSTILE_SITE_KEY` | Variable | Site Key cho trang đăng nhập / form liên kết bạn bè |
| `TURNSTILE_SECRET_KEY` | Secret | Server key xác minh |
| `MCP_BEARER_TOKEN` | Secret | Bearer token cho `/api/mcp` |

#### 6.3 Tùy chọn

| Tên | Loại | Mô tả |
| --- | --- | --- |
| `GITHUB_OAUTH_REDIRECT_URI` | Variable | OAuth callback URL tùy chỉnh |
| `AUTO_DEPLOY_WEBHOOK_URL` | Variable | Trigger auto build sau khi đăng bài |
| `AUTO_DEPLOY_WEBHOOK_SECRET` | Secret | Token xác thực deploy hook |
| `AUTO_DEPLOY_GITHUB_EVENT_TYPE` | Variable | Tên dispatch event GitHub, mặc định `rebuild-search-index` |
| `MCP_RATE_LIMIT_PER_MINUTE` | Variable | Giới hạn MCP mỗi phút mỗi IP |
| `MCP_AUTH_FAIL_LIMIT_PER_MINUTE` | Variable | Ngưỡng thất bại xác thực MCP |
| `MCP_AUTH_BLOCK_SECONDS` | Variable | Thời gian block tạm thời MCP (giây) |
| `AI_INTERNAL_API_KEY` | Secret / Variable | AI cho trang quản trị |
| `AI_PUBLIC_API_KEY` | Secret / Variable | AI công khai cho trang chính |
| `PUBLIC_AI_RATE_LIMIT_PER_MINUTE` | Variable | Giới hạn AI công khai mỗi phút mỗi IP |
| `PUBLIC_AI_DAILY_LIMIT_PER_IP` | Variable | Giới hạn hàng ngày AI công khai mỗi IP |

#### 6.4 Đừng quên resource bindings

Ngoài biến, còn cần xác nhận Cloudflare project đã bind:

- `DB` (D1)
- `SESSION` (KV)
- `MEDIA_BUCKET` (R2)

### Bước 7: Lần đầu lên production, nhất định phải thực hiện D1 migration remote

Điều này rất quan trọng.

**Cloudflare auto build sẽ giúp deploy code, nhưng sẽ không tự khởi tạo cấu trúc bảng D1.**

Vì vậy, trước lần đầu lên production, ít nhất phải thực hiện:

```bash
npm run db:migrate:remote
```

Nếu chưa login Wrangler, login trước:

```bash
npx wrangler login
```

> Sau này, chỉ cần thêm migration mới trong `drizzle/`, thì cũng phải chạy `npm run db:migrate:remote`.
>
> Nếu chỉ sửa UI, văn bản, logic API mà **không thay đổi cấu trúc database**, thì bình thường `push` là Cloudflare auto deploy.

### Bước 8: Chạy thử cục bộ trước (rất khuyến nghị)

Khuyến nghị kiểm tra cục bộ trước:

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Nếu muốn insert dữ liệu mẫu vào D1 cục bộ:

```bash
npm run db:seed:local
```

Sau đó kiểm tra những điểm quan trọng:

- Trang chính và trang lưu trữ có hiển thị bình thường không
- Trang tìm kiếm có chỉ mục không
- Trang đăng nhập quản trị có hiển thị nút đăng nhập GitHub không
- Tạo bài viết mới có lưu được không
- Upload ảnh có bình thường không

### Bước 9: Sau khi lên production lần đầu, kiểm tra những việc sau

Sau khi lên production, tự kiểm tra theo thứ tự:

1. Trang chính có hiển thị bình thường không
2. Trang `/blog` có hoạt động bình thường không
3. Trang `/search` có thể tìm kiếm được bài viết không
4. `/api/auth/login` có thể đăng nhập quản trị qua GitHub OAuth không
5. Tạo bài viết mới và publish từ trang quản trị
6. Nếu bật R2, test upload ảnh
7. Mở một bài viết, xem bình luận có phải là cấu hình Giscus của bạn không

## Cách hoạt động của tìm kiếm Pagefind

Tìm kiếm trong project này không truy vấn database real-time, mà tạo chỉ mục tĩnh khi build.

### File quan trọng

- Script tạo chỉ mục: `scripts/build-pagefind-index.mjs`
- Thư mục output chỉ mục: `public/pagefind/`
- File metadata: `public/pagefind-meta.json`
- Logic tìm kiếm frontend: `public/pagefind-search.js`

### Logic build

`npm run build` sẽ thực thi mặc định:

```bash
npm run search:index:auto
```

Nghĩa là:

1. Ưu tiên đọc D1 cục bộ
2. Nếu D1 cục bộ không có bài viết, tự động fallback D1 remote
3. Tạo chỉ mục Pagefind theo bài viết public
4. Sau đó thực thi `astro build`

### Điều cần nhớ

- **Kết quả tìm kiếm đến từ kết quả build, không phải truy vấn database real-time.**
- Sau khi đăng bài từ trang quản trị, trang bài viết có thể truy cập ngay; nhưng kết quả tìm kiếm có cập nhật ngay hay không, phụ thuộc vào việc có rebuild hay không.
- Nếu cấu hình "đăng bài từ quản trị -> GitHub Actions auto deploy", tìm kiếm sẽ tự động cập nhật.
- Nếu không cấu hình, thì đợi lần `push` hoặc deploy thủ công tiếp theo.

### Lệnh liên quan

| Lệnh | Mô tả |
| --- | --- |
| `npm run search:index:auto` | Ưu tiên đọc D1 cục bộ, nếu rỗng tự động fallback D1 remote |
| `npm run search:index:local` | Cưỡng ép đọc D1 cục bộ và tạo chỉ mục |
| `npm run search:index:remote` | Cưỡng ép đọc D1 remote và tạo chỉ mục |

## Auto rebuild sau khi đăng bài: Cloudflare + GitHub Actions

Đây là phần dễ gây nhầm lẫn nhất nhưng cũng hữu ích nhất.

### Trước tiên hiểu phân công trách nhiệm

#### Sửa code thường ngày

- Bạn `push`
- Cloudflare Dashboard auto build và deploy

#### Đăng bài từ trang quản trị

- Trang quản trị ghi bài viết vào D1 trước
- Sau đó trigger external build qua `AUTO_DEPLOY_WEBHOOK_URL`
- Repo này khuyến nghị trigger GitHub `repository_dispatch`
- GitHub Actions thực thi `npm run deploy`

### File đã chuẩn bị sẵn trong repo

- Logic trigger webhook: `src/admin/lib/deploy-hook.ts`
- GitHub Actions workflow: `.github/workflows/auto-deploy-from-admin.yml`

### Bạn cần cấu hình gì

#### 1. Biến Cloudflare runtime

```
AUTO_DEPLOY_WEBHOOK_URL=https://api.github.com/repos/<owner>/<repo>/dispatches
AUTO_DEPLOY_WEBHOOK_SECRET=<GitHub Token có quyền gọi dispatch API của repo này>
AUTO_DEPLOY_GITHUB_EVENT_TYPE=rebuild-search-index
```

Trong đó:

- `AUTO_DEPLOY_WEBHOOK_URL` trỏ đến repo của bạn, không phải repo gốc
- `AUTO_DEPLOY_WEBHOOK_SECRET` khuyến nghị dùng:
  - PAT cổ điển: có scope `repo`
  - Hoặc PAT chi tiết: có ít nhất `Contents: write` đối với repo đó

#### 2. GitHub repo Secrets

Workflow hỗ trợ hai phương án Cloudflare credentials:

**Phương án A: Khuyến nghị, ổn định nhất**

- `CLOUDFLARE_API_TOKEN`

**Phương án B: Phương án dự phòng**

- `CLOUDFLARE_REFRESH_TOKEN`
- Nếu muốn workflow tự động ghi lại refresh token mới, thêm: `GH_ADMIN_TOKEN`

### Workflow này sẽ làm gì

`.github/workflows/auto-deploy-from-admin.yml` sẽ:

1. Nhận `repository_dispatch`
2. Cài đặt dependencies
3. Chuẩn bị Cloudflare Token
4. Thực thi `npm run deploy`

Còn `npm run deploy` sẽ làm:

```
npm run db:migrate:remote
npm run search:index:remote
astro build
wrangler deploy
```

Nghĩa là, sẽ dùng **D1 remote** để rebuild chỉ mục, rồi deploy lại.

### Phương pháp test khuyến nghị

1. Deploy toàn bộ site bình thường trước
2. Cấu hình webhook và GitHub Secrets như trên
3. Đăng nhập trang quản trị
4. Publish một bài viết mới
5. Vào GitHub Actions xem `后台发布自动部署` có được trigger không
6. Đợi Actions hoàn thành, sau đó vào trang tìm kiếm tìm tiêu đề bài viết mới

Nếu tìm được, nghĩa là toàn bộ luồng đã thông.

## Cấu hình bình luận Giscus

Phần bình luận trong project này là **Giscus**, tức GitHub Discussions bình luận.

### Bạn cần chuẩn bị gì

1. Repo GitHub của riêng bạn
2. Bật `Discussions` trong repo này
3. Chọn một category trong Discussions cho bình luận
4. Vào `https://giscus.app/zh-CN` để tạo cấu hình

### Các bước cấu hình

#### 1. Bật GitHub Discussions

Bật Discussions trong repo GitHub của bạn.

#### 2. Chuẩn bị một category

Thường dùng trực tiếp `Announcements`, cũng có thể tự tạo category khác.

#### 3. Vào giscus.app lấy tham số

Trang Giscus sẽ giúp bạn lấy các giá trị sau:

- `repo`
- `repoId`
- `category`
- `categoryId`

#### 4. Điền vào `src/lib/types.ts`

Cấu trúc ví dụ như sau:

```ts
comments: {
  provider: "giscus",
  repo: "TÊN-USER/TÊN-REPO",
  repoId: "repoId-của-bạn",
  category: "Announcements",
  categoryId: "categoryId-của-bạn",
  mapping: "pathname",
  strict: false,
  reactionsEnabled: true,
  inputPosition: "top",
  lang: "zh-CN",
}
```

### Đặc điểm bình luận trong project này

- Mặc định ẩn, user click mới load Giscus
- Tự động chuyển theo theme sáng/tối
- Nếu repo chưa cấu hình Discussions, sẽ hiển thị gợi ý trên trang, không phải trắng toàn màn hình

### Nếu tạm thời không muốn bật bình luận

Có hai cách đơn giản nhất:

1. Sửa cấu hình bình luận trong `src/lib/types.ts` thành thông tin thật của bạn rồi bật
2. Hoặc xóa trắng các trường quan trọng của bình luận, để component vào trạng thái "chưa cấu hình"

Tóm lại, không nên tiếp tục trỏ đến repo gốc, nếu không bình luận sẽ chạy đến Discussions sai.

## Danh sách cấu hình tính năng tùy chọn

| Tính năng | Bắt buộc | Vị trí cấu hình | Mô tả |
| --- | --- | --- | --- |
| Turnstile | Không | `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY` | Xác minh con người cho trang đăng nhập, form liên kết bạn bè |
| Giscus bình luận | Không | `src/lib/types.ts` | GitHub Discussions bình luận |
| Quản lý media | Khuyến nghị mạnh | `MEDIA_BUCKET` | Upload ảnh từ trang quản trị |
| Auto rebuild quản trị | Không, nhưng khuyến nghị | `AUTO_DEPLOY_*` + GitHub Actions Secrets | Auto cập nhật tìm kiếm sau khi đăng bài |
| MCP đăng bài | Không | `MCP_BEARER_TOKEN` v.v | Giao diện đăng bài cho AI bên ngoài / công cụ tự động |
| AI công khai | Không | `AI_PUBLIC_API_KEY` v.v | Tính năng AI công khai trên trang chính |
| AI quản trị | Không | `AI_INTERNAL_API_KEY` v.v | Tính năng AI trong trang quản trị |

## Phát triển cục bộ

Khuyến nghị sử dụng `Node.js 22+` và `npm`.

```bash
git clone https://github.com/TÊN-USER/cf-astro-blog.git
cd cf-astro-blog
npm install
cp .dev.vars.example .dev.vars
npm run db:migrate:local
npm run dev
```

Nếu cần tạo hash mật khẩu quản trị, thực thi:

```bash
npm run hash:password -- MẬT-KHẨU-CỦA-BẠN
```

> Giải thích: Luồng chính hiện tại của trang quản trị là đăng nhập qua GitHub OAuth.
>
> `ADMIN_PASSWORD_HASH` chủ yếu để tương thích cấu hình cũ hoặc giữ khả năng script, không còn là phương thức đăng nhập khuyến nghị.

## Các lệnh thường dùng

| Lệnh | Mô tả |
| --- | --- |
| `npm run dev` | Khởi động dev server cục bộ |
| `npm run build` | Tạo bản production (sẽ tạo chỉ mục Pagefind trước) |
| `npm run preview` | Preview sau build bằng Wrangler cục bộ |
| `npm run deploy` | Migration remote + chỉ mục remote + build + deploy |
| `npm run check` | Chạy type check và Biome check |
| `npm run lint` | Chạy Biome lint |
| `npm run format` | Format code, script, test và README |
| `npm test` | Chạy automated test |
| `npm run db:migrate:local` | Áp dụng D1 migration cục bộ |
| `npm run db:migrate:remote` | Áp dụng D1 migration online |
| `npm run db:seed:local` | Import dữ liệu mẫu vào D1 cục bộ |
| `npm run db:seed:remote` | Import dữ liệu mẫu vào D1 remote (cẩn thận) |
| `npm run search:index:auto` | Tự động chọn D1 cục bộ / remote để tạo chỉ mục tìm kiếm |
| `npm run search:index:local` | Cưỡng ép đọc D1 cục bộ để tạo chỉ mục |
| `npm run search:index:remote` | Cưỡng ép đọc D1 remote để tạo chỉ mục |

## SEO và Đăng ký

- `sitemap.xml`: Xuất động bởi `src/pages/sitemap.xml.ts`, bao gồm trang công khai và bài viết visible.
- `rss.xml`: Xuất động bởi `src/pages/rss.xml.ts`, mặc định bao gồm 30 bài viết public gần nhất.
- `robots.txt`: Xuất bởi `src/pages/robots.txt.ts`, cho phép crawl trang công khai, chặn trang đăng nhập và quản trị liên quan (`/api/auth`, `/api/admin`, `/admin`).
- `webmention`: Endpoint nhận `/api/webmention` được cung cấp bởi `src/admin/routes/webmention.ts`, sau khi xác minh `source/target` sẽ ghi vào hàng đợi duyệt; trang quản trị duyệt tại `/api/admin/mentions`.

## Kiểm tra trước khi deploy

Trước khi lên production, ít nhất xác nhận những điều sau:

1. `wrangler.jsonc` đã được thay thế thành tài nguyên và domain của bạn.
2. `src/lib/types.ts` đã được sửa thành thông tin site của bạn.
3. `JWT_SECRET`, `ADMIN_GITHUB_LOGIN`, `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` đã được cấu hình.
4. Nếu bật Turnstile, cả `TURNSTILE_SITE_KEY` và `TURNSTILE_SECRET_KEY` đều đã cấu hình.
5. Nếu muốn bật thư viện media, `MEDIA_BUCKET` đã bind.
6. Nếu muốn bật bình luận, `repoId` và `categoryId` của Giscus đã được thay.
7. Đã thực hiện `npm run db:migrate:remote` lần đầu.
8. Trước khi lên production đã chạy `npm run check` và `npm test`.

## Hướng dẫn bảo trì sau khi lên production

- Chỉ sửa UI / văn bản / tương tác / logic API (không thay đổi cấu trúc bảng D1): **chỉ cần `push`**, Cloudflare sẽ auto build deploy.
- Thay đổi cấu trúc database (thêm bảng / trường / index): **Sau khi deploy phải thực hiện `npm run db:migrate:remote`**.
- Sau khi đăng bài từ quản trị mà thấy tìm kiếm không cập nhật: Ưu tiên kiểm tra luồng auto deploy GitHub Actions có được cấu hình hoàn chỉnh không.
- Quy trình bảo trì đầy đủ và xử lý lỗi xem: [docs/maintenance-guide.md](docs/maintenance-guide.md).

## Câu hỏi thường gặp

### 1. Site đã lên production, nhưng tiêu đề, Logo, bình luận vẫn là của tác giả gốc

Nghĩa là bạn chỉ chạy được repo, nhưng chưa thay thế thương hiệu.

Ưu tiên kiểm tra:

- `src/lib/types.ts`
- `src/components/BaseHead.astro`
- `src/components/Header.astro`
- `src/admin/views/login.ts`
- `src/components/Footer.astro`

### 2. Trang đăng nhập quản trị hiển thị "GitHub OAuth chưa được cấu hình"

Ưu tiên kiểm tra:

- `ADMIN_GITHUB_LOGIN`
- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_OAUTH_REDIRECT_URI` (nếu bạn đặt thủ công)

### 3. Bài viết mới đã publish, nhưng tìm kiếm không thấy

Đây thường không phải do bài viết chưa publish, mà là **Pagefind chưa được rebuild**.

Thứ tự kiểm tra:

1. Trạng thái bài viết trong quản trị có phải `published` không
2. GitHub Actions auto deploy có được trigger không
3. Nếu không cấu hình auto deploy, thì rebuild / deploy thủ công một lần

### 4. Database báo lỗi, trang 500, một số danh sách trong quản trị trống

Có thể là do D1 chưa migrate.

Thực thi:

```bash
npm run db:migrate:remote
```

### 5. Đổi domain ảnh, nhưng trang chính / quản trị không hiển thị

Kiểm tra xem có phải chỉ đổi địa chỉ ảnh mà chưa sửa CSP whitelist không:

- `src/middleware.ts`
- `src/admin/app.ts`

### 6. Bình luận Giscus không mở được hoặc load Discussions của người khác

Ưu tiên kiểm tra `src/lib/types.ts`:

- `comments.repo`
- `comments.repoId`
- `comments.category`
- `comments.categoryId`

## Giấy phép

Project sử dụng [MIT](LICENSE).
