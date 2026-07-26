# KUMOHIRO Daka

员工工作安排、浏览器设备授权和上下班考勤系统。项目为独立应用，与官网
`g-web` 分开运行；二者只共用 Windows Nginx 的 80/443 入口。

## 技术和目录

- React + TypeScript + Vite：员工前台和 `/admin` 管理后台
- Node.js + Express：仅监听本机 `127.0.0.1:14100`
- SQLite：`storage/database/daka.db`
- 图片：`storage/uploads`
- Nginx：提供前端静态文件，并把 `/api/` 反向代理到 Node.js
- 时区：后台分别设置服务器时区和程序显示时区；数据库时间戳统一保存为 UTC

不需要 WSL、Docker、IIS，也不需要再开放一个公网端口。

## Windows 本地开发

需要 Node.js 22 或更高版本。

```powershell
Copy-Item .env.example .env
npm install
npm run dev
```

也可以直接双击项目根目录的 `start-dev.bat`。它会先构建前端，然后以不自动
重启的稳定模式启动，并自动打开 `http://127.0.0.1:14100/`。服务运行期间保留
该命令窗口；关闭窗口时服务会停止。此模式的后台地址为
`http://127.0.0.1:14100/admin`。

- 前台：`http://127.0.0.1:5173/`
- 后台：`http://127.0.0.1:5173/admin`
- API：`http://127.0.0.1:14100`（只供本机和 Vite/Nginx 使用）

新数据库的开发环境默认管理员为 `admin / admin123`，首次登录后必须修改密码。
`.env` 中的初始密码只在数据库第一次创建管理员时生效。

## 测试和构建

```powershell
npm run check
```

它会依次执行后端测试、TypeScript 类型检查和生产构建。也可以在 Windows
PowerShell 中运行：

```powershell
.\scripts\build-production.ps1
```

构建结果位于 `client/dist`。

## Windows 生产部署

1. 复制 `.env.example` 为 `.env`。
2. 设置长度至少 32 位的随机 `SESSION_SECRET` 和非默认的管理员初始密码。
3. 将 `APP_ORIGIN` 改为 `https://daka.kumohiro.com`。
4. 运行 `.\scripts\build-production.ps1`。
5. 用 `.\scripts\start-api.ps1` 启动前端与 API 服务。
6. 参考 `deploy/nginx-daka.conf.example` 配置现有 Windows Nginx。

建议用 Windows“任务计划程序”在开机时运行：

- 程序：`powershell.exe`
- 参数：`-NoProfile -ExecutionPolicy Bypass -File D:\www\daka\scripts\start-api.ps1`
- 起始于：`D:\www\daka`
- 选择“无论用户是否登录都要运行”和“如果任务失败则重新启动”

API 仍只占用本机 14100 端口；公网只访问 Nginx 的 80/443。官网的
`www.kumohiro.com` 与本项目的 `daka.kumohiro.com` 使用不同 `server_name`
配置，因此完全分离。

## 数据说明

SQLite 适合这个低并发内部系统，资源消耗远低于额外部署 MySQL/PostgreSQL。
数据库与上传图片需要一起保留。系统暂不自动备份；管理员可以按日期、员工和
数据类型清理历史记录，删除前应自行复制 `.db` 文件和 `storage/uploads`。
